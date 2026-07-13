import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  reconcileWorktrees,
  ReviveThresholdMs,
} from '../../src/lib/worktrees/reconcile'
import { IWorktreeMetadata } from '../../src/models/worktree-metadata'
import { WorktreeEntry, WorktreeType } from '../../src/models/worktree'

const COMMON = '/repo/.git'
const NOW = 1_000_000_000

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

function row(over: Partial<IWorktreeMetadata>): IWorktreeMetadata {
  return {
    id: 1,
    commonGitDir: COMMON,
    worktreeName: 'wt',
    generation: 0,
    path: '/repo/wt',
    branch: 'refs/heads/x',
    head: 'aaa',
    isDetached: false,
    parentWorktreeName: null,
    lineageTaskRef: null,
    baseRef: null,
    manualStatus: null,
    manualStatusDerivedFrom: null,
    checkpointText: null,
    checkpointAuthorKind: null,
    checkpointAuthorId: null,
    checkpointHeadSha: null,
    checkpointUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: NOW,
    orphanedAt: null,
    ...over,
  }
}

const names = (m: Record<string, string>) => new Map(Object.entries(m))

describe('reconcileWorktrees', () => {
  it('inserts a never-seen worktree at generation 0', () => {
    const plan = reconcileWorktrees(
      [],
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toInsert.length, 1)
    assert.strictEqual(plan.toInsert[0].generation, 0)
    assert.strictEqual(plan.toInsert[0].worktreeName, 'wt')
    assert.deepStrictEqual(plan.toUpdate, [])
    assert.deepStrictEqual(plan.toOrphan, [])
    assert.deepStrictEqual(plan.toRevive, [])
  })

  it('updates the git mirror of a live worktree, never its managed state', () => {
    const plan = reconcileWorktrees(
      [row({ id: 7, head: 'aaa', checkpointText: 'keep me' })],
      [entry('/repo/wt-moved', 'bbb', 'refs/heads/y')],
      names({ '/repo/wt-moved': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toUpdate.length, 1)
    assert.deepStrictEqual(plan.toUpdate[0], {
      id: 7,
      path: '/repo/wt-moved',
      branch: 'refs/heads/y',
      head: 'bbb',
      isDetached: false,
      lastSeenAt: NOW,
    })
    assert.strictEqual(plan.toInsert.length, 0)
  })

  it('orphans a live row whose worktree is gone, never deleting it', () => {
    const plan = reconcileWorktrees(
      [row({ id: 7 })],
      [],
      names({}),
      COMMON,
      NOW
    )
    assert.deepStrictEqual(plan.toOrphan, [{ id: 7, orphanedAt: NOW }])
    assert.strictEqual(plan.toInsert.length, 0)
  })

  it('revives a recently orphaned row when HEAD still matches (transient blip)', () => {
    const plan = reconcileWorktrees(
      [row({ id: 7, head: 'aaa', orphanedAt: NOW - 5_000 })],
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toRevive.length, 1)
    assert.strictEqual(plan.toRevive[0].id, 7)
    assert.strictEqual(plan.toInsert.length, 0)
  })

  it('does NOT revive when HEAD differs — a recreation gets a new generation', () => {
    const plan = reconcileWorktrees(
      [row({ id: 7, head: 'aaa', generation: 0, orphanedAt: NOW - 5_000 })],
      [entry('/repo/wt', 'zzz')],
      names({ '/repo/wt': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toRevive.length, 0)
    assert.strictEqual(plan.toInsert.length, 1)
    assert.strictEqual(plan.toInsert[0].generation, 1)
  })

  it('does NOT revive an orphan older than the threshold', () => {
    const plan = reconcileWorktrees(
      [row({ id: 7, head: 'aaa', orphanedAt: NOW - ReviveThresholdMs - 1 })],
      [entry('/repo/wt', 'aaa')],
      names({ '/repo/wt': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toRevive.length, 0)
    assert.strictEqual(plan.toInsert.length, 1)
    assert.strictEqual(plan.toInsert[0].generation, 1)
  })

  it('recreation at a reused path takes max(generation)+1', () => {
    const plan = reconcileWorktrees(
      [
        row({ id: 1, generation: 0, orphanedAt: NOW - 10_000 }),
        row({ id: 2, generation: 1, head: 'aaa', orphanedAt: NOW - 10_000 }),
      ],
      [entry('/repo/wt', 'zzz')],
      names({ '/repo/wt': 'wt' }),
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toInsert.length, 1)
    assert.strictEqual(plan.toInsert[0].generation, 2)
  })

  it('skips an entry whose administrative name cannot be resolved', () => {
    const plan = reconcileWorktrees(
      [],
      [entry('/repo/wt', 'aaa')],
      names({}), // no name for the path
      COMMON,
      NOW
    )
    assert.strictEqual(plan.toInsert.length, 0)
    assert.strictEqual(plan.toUpdate.length, 0)
  })

  it('handles a mixed pass: one update, one insert, one orphan', () => {
    const plan = reconcileWorktrees(
      [
        row({ id: 1, worktreeName: '(main)', path: '/repo', head: 'm1' }),
        row({ id: 2, worktreeName: 'gone', path: '/repo/gone', head: 'g1' }),
      ],
      [
        entry('/repo', 'm2', 'refs/heads/main', 'main'),
        entry('/repo/new', 'n1'),
      ],
      names({ '/repo': '(main)', '/repo/new': 'new' }),
      COMMON,
      NOW
    )
    assert.deepStrictEqual(
      plan.toUpdate.map(u => u.id),
      [1]
    )
    assert.deepStrictEqual(
      plan.toOrphan.map(o => o.id),
      [2]
    )
    assert.deepStrictEqual(
      plan.toInsert.map(i => i.worktreeName),
      ['new']
    )
  })
})
