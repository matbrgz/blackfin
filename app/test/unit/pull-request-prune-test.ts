import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IPrunablePullRequest,
  selectPullRequestsToPrune,
} from '../../src/lib/pull-request-prune'
import { PullRequestKey } from '../../src/lib/databases/pull-request-database'
import { PullRequestState } from '../../src/models/pull-request'

const NOW = Date.parse('2026-07-13T00:00:00Z')
const daysAgo = (n: number) =>
  new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

function pr(
  prNumber: number,
  state: PullRequestState,
  updatedAt: string,
  headRef = `ref-${prNumber}`
): IPrunablePullRequest {
  return { key: [1, prNumber] as PullRequestKey, state, updatedAt, headRef }
}

const keys = (ks: ReadonlyArray<PullRequestKey>) => ks.map(k => k[1]).sort()

describe('selectPullRequestsToPrune', () => {
  it('never prunes an open PR, however old', () => {
    const prune = selectPullRequestsToPrune(
      [pr(1, 'open', daysAgo(1000))],
      new Set(),
      NOW
    )
    assert.deepStrictEqual([...prune], [])
  })

  it('prunes a long-merged PR whose branch is gone', () => {
    const prune = selectPullRequestsToPrune(
      [pr(1, 'merged', daysAgo(200))],
      new Set(),
      NOW
    )
    assert.deepStrictEqual(keys(prune), [1])
  })

  it('keeps a long-merged PR whose branch is still known', () => {
    const prune = selectPullRequestsToPrune(
      [pr(1, 'merged', daysAgo(200), 'fix/auth')],
      new Set(['fix/auth']),
      NOW
    )
    assert.deepStrictEqual([...prune], [])
  })

  it('caps non-open PRs per repo, pruning the oldest', () => {
    const prs: Array<IPrunablePullRequest> = []
    // 700 recent closed PRs, all on distinct dead branches.
    for (let i = 1; i <= 700; i++) {
      prs.push(pr(i, 'closed', daysAgo((i % 80) + 1)))
    }
    const prune = selectPullRequestsToPrune(prs, new Set(), NOW, {
      maxClosedPerRepo: 500,
    })
    assert.strictEqual(prune.length, 200)

    // Everything pruned must be older than everything kept.
    const prunedNumbers = new Set(prune.map(k => k[1]))
    const oldestKept = Math.min(
      ...prs
        .filter(p => !prunedNumbers.has(p.key[1]))
        .map(p => Date.parse(p.updatedAt))
    )
    const newestPruned = Math.max(
      ...prs
        .filter(p => prunedNumbers.has(p.key[1]))
        .map(p => Date.parse(p.updatedAt))
    )
    assert.ok(newestPruned <= oldestKept)
  })
})
