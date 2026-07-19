import { describe, it } from 'node:test'
import assert from 'node:assert'
import { ITaskLink } from '../../src/models/task'
import {
  AncestorPredicate,
  applyCorrectedBranchName,
  linkForBranch,
  linksForTask,
  resolveTaskForBranch,
  statusOfLinks,
  TaskLinkMatch,
  taskLinkIdentity,
  upsertLink,
} from '../../src/lib/tasks/task-link'

function link(overrides: Partial<ITaskLink> = {}): ITaskLink {
  return {
    taskKey: 'github-issues:123',
    repositoryId: 1,
    branchName: '123-fix-token',
    createdAtSha: 'aaaa',
    worktreePath: null,
    createdAt: 1000,
    ...overrides,
  }
}

// A predicate driven by an explicit ancestor→descendants table, so the reconcile
// logic is exercised without any git. `never` is the honest default: unknown
// SHAs are not related.
function ancestryFrom(
  table: ReadonlyMap<string, ReadonlyArray<string>>
): AncestorPredicate {
  return (ancestorSha, tipSha) => {
    if (ancestorSha === tipSha) {
      return true
    }
    return (table.get(ancestorSha) ?? []).includes(tipSha)
  }
}

const never: AncestorPredicate = () => false

describe('linksForTask', () => {
  it('returns only the links for the given task key', () => {
    const links = [
      link({ taskKey: 'a', branchName: 'x' }),
      link({ taskKey: 'b', branchName: 'y' }),
      link({ taskKey: 'a', branchName: 'z' }),
    ]
    const forA = linksForTask(links, 'a')
    assert.strictEqual(forA.length, 2)
    assert.deepStrictEqual(
      forA.map(l => l.branchName),
      ['x', 'z']
    )
  })

  it('does not mutate the input', () => {
    const links = [link()]
    linksForTask(links, 'nope')
    assert.strictEqual(links.length, 1)
  })
})

describe('linkForBranch', () => {
  const links = [
    link({ repositoryId: 1, branchName: 'feat-a' }),
    link({ repositoryId: 2, branchName: 'feat-a' }),
  ]

  it('matches on the exact repository and branch name', () => {
    const found = linkForBranch(links, 2, 'feat-a')
    assert.strictEqual(found?.repositoryId, 2)
  })

  it('returns null when nothing matches', () => {
    assert.strictEqual(linkForBranch(links, 1, 'missing'), null)
    assert.strictEqual(linkForBranch(links, 3, 'feat-a'), null)
  })
})

describe('taskLinkIdentity / upsertLink', () => {
  it('two branches for one task coexist and never collide', () => {
    let links: ReadonlyArray<ITaskLink> = []
    links = upsertLink(links, link({ branchName: 'attempt-1' }))
    links = upsertLink(links, link({ branchName: 'attempt-2' }))
    assert.strictEqual(links.length, 2)
    assert.strictEqual(linksForTask(links, 'github-issues:123').length, 2)
  })

  it('re-linking the same triple upserts in place rather than duplicating', () => {
    let links: ReadonlyArray<ITaskLink> = [
      link({ branchName: 'b', createdAtSha: 'old' }),
    ]
    links = upsertLink(links, link({ branchName: 'b', createdAtSha: 'new' }))
    assert.strictEqual(links.length, 1)
    assert.strictEqual(links[0].createdAtSha, 'new')
  })

  it('distinguishes triples that differ only by branch name', () => {
    assert.notStrictEqual(
      taskLinkIdentity(link({ branchName: 'a' })),
      taskLinkIdentity(link({ branchName: 'b' }))
    )
  })

  it('is not fooled by a branch name that embeds a separator', () => {
    // A crafted name must not forge the identity of a different triple.
    assert.notStrictEqual(
      taskLinkIdentity(link({ repositoryId: 1, branchName: 'a' })),
      taskLinkIdentity(link({ repositoryId: 1, branchName: 'a","1' }))
    )
  })
})

describe('resolveTaskForBranch', () => {
  it('resolves by exact name, with no correction', () => {
    const links = [link({ branchName: 'feat', createdAtSha: 'aaaa' })]
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'feat', tipSha: 'aaaa' },
      never
    )
    assert.ok(resolved)
    assert.strictEqual(resolved.match, TaskLinkMatch.ByName)
    assert.strictEqual(resolved.correctedBranchName, null)
  })

  it('re-finds a renamed branch by createdAtSha ancestry and self-corrects', () => {
    // The branch was `old-name` (sha aaaa); the user ran `git branch -m` to
    // `new-name`, whose tip bbbb descends from aaaa.
    const links = [link({ branchName: 'old-name', createdAtSha: 'aaaa' })]
    const isAncestor = ancestryFrom(new Map([['aaaa', ['bbbb']]]))
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'new-name', tipSha: 'bbbb' },
      isAncestor,
      ['new-name']
    )
    assert.ok(resolved)
    assert.strictEqual(resolved.match, TaskLinkMatch.ByAncestry)
    assert.strictEqual(resolved.correctedBranchName, 'new-name')
    assert.strictEqual(resolved.link.branchName, 'old-name')
  })

  it('does not steal a link whose stored name still names a live branch', () => {
    // aaaa is an ancestor of bbbb, but `old-name` still exists — so the link is
    // correctly attached there and must not be pulled onto `new-name`.
    const links = [link({ branchName: 'old-name', createdAtSha: 'aaaa' })]
    const isAncestor = ancestryFrom(new Map([['aaaa', ['bbbb']]]))
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'new-name', tipSha: 'bbbb' },
      isAncestor,
      ['old-name', 'new-name']
    )
    assert.strictEqual(resolved, null)
  })

  it('returns null when no name matches and no ancestry holds', () => {
    const links = [link({ branchName: 'x', createdAtSha: 'aaaa' })]
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'y', tipSha: 'zzzz' },
      never
    )
    assert.strictEqual(resolved, null)
  })

  it('ignores links from a different repository', () => {
    const links = [
      link({ repositoryId: 2, branchName: 'feat', createdAtSha: 'aaaa' }),
    ]
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'feat', tipSha: 'aaaa' },
      (a, b) => a === b
    )
    assert.strictEqual(resolved, null)
  })

  it('breaks an ancestry tie deterministically by newest link', () => {
    const links = [
      link({ branchName: 'a', createdAtSha: 'aaaa', createdAt: 1 }),
      link({ branchName: 'b', createdAtSha: 'aaaa', createdAt: 2 }),
    ]
    const isAncestor = ancestryFrom(new Map([['aaaa', ['tip']]]))
    const resolved = resolveTaskForBranch(
      links,
      1,
      { name: 'renamed', tipSha: 'tip' },
      isAncestor,
      ['renamed']
    )
    assert.ok(resolved)
    assert.strictEqual(resolved.link.branchName, 'b')
  })
})

describe('applyCorrectedBranchName', () => {
  it('returns a copy with the new name and no mutation', () => {
    const original = link({ branchName: 'old' })
    const corrected = applyCorrectedBranchName(original, 'new')
    assert.strictEqual(corrected.branchName, 'new')
    assert.strictEqual(original.branchName, 'old')
    assert.strictEqual(corrected.createdAtSha, original.createdAtSha)
  })
})

describe('statusOfLinks', () => {
  it('reports a deleted branch as absent without removing the link', () => {
    const links = [
      link({ branchName: 'present' }),
      link({ branchName: 'gone' }),
    ]
    const status = statusOfLinks(links, ['present'])
    assert.strictEqual(status.length, 2)
    assert.strictEqual(status[0].branchPresent, true)
    assert.strictEqual(status[1].branchPresent, false)
    // The orphan is still there — reading never deletes.
    assert.strictEqual(links.length, 2)
  })

  it('marks everything absent when no branches exist', () => {
    const status = statusOfLinks([link()], [])
    assert.strictEqual(status[0].branchPresent, false)
  })
})
