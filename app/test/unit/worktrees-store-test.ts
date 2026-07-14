import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { WorktreesDatabase } from '../../src/lib/databases/worktrees-database'
import {
  WorktreesStore,
  sanitizeCheckpointText,
} from '../../src/lib/stores/worktrees-store'
import { MaxCheckpointLength } from '../../src/models/worktree-metadata'
import { WorktreeEntry, WorktreeType } from '../../src/models/worktree'

const COMMON = '/repo/.git'

function entry(
  path: string,
  head: string,
  branch: string | null = 'refs/heads/x',
  type: WorktreeType = 'linked'
): WorktreeEntry {
  return {
    path,
    head,
    branch,
    isDetached: branch === null,
    type,
    isLocked: false,
    isPrunable: false,
  }
}

const names = (m: Record<string, string>) => new Map(Object.entries(m))

describe('WorktreesStore', () => {
  let db: WorktreesDatabase
  let store: WorktreesStore

  beforeEach(async () => {
    db = new WorktreesDatabase('TestBlackfinWorktrees')
    await db.delete()
    await db.open()
    store = new WorktreesStore(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('persists an insert then updates its git mirror, keeping the checkpoint', async () => {
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      1000
    )
    await store.setCheckpoint(
      COMMON,
      'wt',
      {
        text: 'halfway',
        authorKind: 'agent',
        authorId: 'claude-code',
        headSha: 'aaa',
      },
      1100
    )

    // A later pass sees the branch moved and HEAD advanced.
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'bbb', 'refs/heads/y')],
      names({ '/repo/wt': 'wt' }),
      1200
    )

    const live = await store.getLive(COMMON)
    assert.strictEqual(live.length, 1)
    assert.strictEqual(live[0].head, 'bbb')
    assert.strictEqual(live[0].branch, 'refs/heads/y')
    assert.strictEqual(live[0].checkpointText, 'halfway')
    assert.strictEqual(live[0].generation, 0)
  })

  it('keeps at most one live row and bumps generation on recreation', async () => {
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      1000
    )
    // Worktree disappears.
    await store.applyReconciliation(COMMON, [], names({}), 2000)
    // Recreated at the same path much later, different HEAD.
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'zzz')],
      names({ '/repo/wt': 'wt' }),
      2_000_000
    )

    const family = await store.getFamily(COMMON)
    const live = family.filter(r => r.orphanedAt === null)
    assert.strictEqual(family.length, 2, 'the orphan is retained for audit')
    assert.strictEqual(live.length, 1, 'exactly one live row')
    assert.strictEqual(live[0].generation, 1)
    assert.strictEqual(live[0].head, 'zzz')
    assert.strictEqual(live[0].checkpointText, null, 'born clean')
  })

  it('createForNewWorktree records lineage and orphans a prior live row', async () => {
    await store.createForNewWorktree(
      COMMON,
      'wt',
      {
        path: '/repo/wt',
        branch: 'refs/heads/a',
        head: 'a1',
        isDetached: false,
      },
      {
        parentWorktreeName: '(main)',
        lineageTaskRef: 'owner/repo#42',
        baseRef: 'main',
      },
      1000
    )
    // A second create at the same key (stale live row present) must not break
    // the one-live-row invariant.
    await store.createForNewWorktree(
      COMMON,
      'wt',
      {
        path: '/repo/wt',
        branch: 'refs/heads/b',
        head: 'b1',
        isDetached: false,
      },
      { lineageTaskRef: 'owner/repo#43' },
      2000
    )

    const family = await store.getFamily(COMMON)
    const live = family.filter(r => r.orphanedAt === null)
    assert.strictEqual(live.length, 1)
    assert.strictEqual(live[0].generation, 1)
    assert.strictEqual(live[0].lineageTaskRef, 'owner/repo#43')
    assert.strictEqual(live[0].parentWorktreeName, null)
  })

  it('sets and clears manual status', async () => {
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      1000
    )
    await store.setManualStatus(
      COMMON,
      'wt',
      'in-review',
      'derived:open-pr',
      1100
    )
    let live = await store.getLive(COMMON)
    assert.strictEqual(live[0].manualStatus, 'in-review')
    assert.strictEqual(live[0].manualStatusDerivedFrom, 'derived:open-pr')

    await store.setManualStatus(COMMON, 'wt', null, 'derived:open-pr', 1200)
    live = await store.getLive(COMMON)
    assert.strictEqual(live[0].manualStatus, null)
    assert.strictEqual(live[0].manualStatusDerivedFrom, null)
  })

  it('does not orphan a live worktree when its name fails to resolve (path fallback)', async () => {
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      1000
    )
    // A later pass where resolveWorktreeIdentity failed for this entry: its path
    // is absent from namesByPath. The worktree is plainly still present, so the
    // store must match it by path and refresh, not orphan it.
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'bbb', 'refs/heads/y')],
      names({}),
      1200
    )
    const live = await store.getLive(COMMON)
    assert.strictEqual(live.length, 1)
    assert.strictEqual(live[0].head, 'bbb')
    assert.strictEqual(live[0].orphanedAt, null)
  })

  it('markOrphanByPath orphans the live row at a path', async () => {
    await store.applyReconciliation(
      COMMON,
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      1000
    )
    await store.markOrphanByPath(COMMON, '/repo/wt', 1500)
    const live = await store.getLive(COMMON)
    assert.strictEqual(live.length, 0)
  })

  it('repairCommonGitDir rewrites the whole family', async () => {
    await store.applyReconciliation(
      COMMON,
      [
        entry('/repo/wt', 'aaa'),
        entry('/repo', 'm', 'refs/heads/main', 'main'),
      ],
      names({ '/repo/wt': 'wt', '/repo': '(main)' }),
      1000
    )
    await store.repairCommonGitDir(COMMON, '/moved/.git', 2000)

    assert.strictEqual((await store.getFamily(COMMON)).length, 0)
    assert.strictEqual((await store.getFamily('/moved/.git')).length, 2)
  })
})

describe('sanitizeCheckpointText', () => {
  it('strips control characters but keeps ordinary text', () => {
    // C0 + DEL, then C1 (0x85 NEL) and the line/paragraph separators.
    const controls = String.fromCharCode(
      9,
      10,
      13,
      0,
      0x7f,
      0x85,
      0x2028,
      0x2029
    )
    assert.strictEqual(sanitizeCheckpointText('a' + controls + 'bcde'), 'abcde')
    assert.strictEqual(sanitizeCheckpointText('hello world'), 'hello world')
  })

  it('caps length at the maximum', () => {
    const out = sanitizeCheckpointText('x'.repeat(MaxCheckpointLength + 50))
    assert.strictEqual(out.length, MaxCheckpointLength)
  })
})
