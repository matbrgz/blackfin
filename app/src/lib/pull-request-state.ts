import { IAPIPullRequest } from './api'
import { PullRequestState } from '../models/pull-request'

/**
 * Blackfin's lifecycle state for a pull request from the API.
 *
 * Order matters: on GitHub a merged PR is *also* `state: 'closed'`, so the merge
 * must be checked first, or every merged PR would read as merely closed — the
 * exact information the board needs, thrown away.
 */
export function toPullRequestState(pr: IAPIPullRequest): PullRequestState {
  if (pr.merged_at != null) {
    return 'merged'
  }
  return pr.state === 'closed' ? 'closed' : 'open'
}
