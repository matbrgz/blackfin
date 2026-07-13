import { PullRequestState } from '../models/pull-request'
import { PullRequestKey } from './databases/pull-request-database'

// Keeping closed and merged PRs is how the PR cache grows without bound, so
// retention is bounded by default. This decides *which keys to remove*; the
// store merely executes them, in the same transaction as the upsert. Pure and
// injectable (`now` is a parameter) so it is testable without a clock.

export interface IPrunablePullRequest {
  readonly key: PullRequestKey
  readonly state: PullRequestState
  /** ISO8601 updated timestamp — lexicographically and Date.parse-sortable. */
  readonly updatedAt: string
  /** The head ref, matched against the set of branches worth keeping. */
  readonly headRef: string
}

/** Closed/merged PRs older than this are candidates for pruning. */
export const DefaultMaxClosedAgeDays = 90

/** At most this many non-open PRs are kept per repository. */
export const DefaultMaxClosedPerRepo = 500

const MsPerDay = 24 * 60 * 60 * 1000

export interface IPruneOptions {
  readonly maxAgeDays?: number
  readonly maxClosedPerRepo?: number
}

/**
 * The keys of the PRs to remove for retention.
 *
 * Open PRs are never pruned. A non-open PR is pruned when it is both older than
 * the age limit and not on a branch worth keeping; and, beyond that, the newest
 * non-open PRs are kept up to the per-repo cap, pruning the oldest — but never a
 * branch-matched one.
 *
 * `knownHeadRefs` is the caller's set of branches worth keeping. Today the store
 * populates it from the open PRs' head refs, so a long-merged PR whose branch is
 * only checked out locally (no open PR shares the ref) is not protected by name
 * and relies on the age limit and cap. Widening the set to the actual checked-
 * out/worktree branches is #59's to do when it wires them through.
 */
export function selectPullRequestsToPrune(
  prs: ReadonlyArray<IPrunablePullRequest>,
  knownHeadRefs: ReadonlySet<string>,
  now: number,
  options: IPruneOptions = {}
): ReadonlyArray<PullRequestKey> {
  const cutoff =
    now - (options.maxAgeDays ?? DefaultMaxClosedAgeDays) * MsPerDay
  const cap = options.maxClosedPerRepo ?? DefaultMaxClosedPerRepo

  const prune: Array<PullRequestKey> = []
  const survivors: Array<IPrunablePullRequest> = []

  for (const pr of prs) {
    if (pr.state === 'open') {
      continue
    }
    const tooOld = Date.parse(pr.updatedAt) < cutoff
    if (tooOld && !knownHeadRefs.has(pr.headRef)) {
      prune.push(pr.key)
    } else {
      survivors.push(pr)
    }
  }

  if (survivors.length > cap) {
    const known = survivors.filter(pr => knownHeadRefs.has(pr.headRef))
    const others = survivors
      .filter(pr => !knownHeadRefs.has(pr.headRef))
      // Newest first, so the tail beyond the cap is the oldest.
      .sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
      )

    const roomForOthers = Math.max(0, cap - known.length)
    for (const pr of others.slice(roomForOthers)) {
      prune.push(pr.key)
    }
  }

  return prune
}
