import { GitHubRepository } from './github-repository'

/** Returns the commit ref for a given pull request number. */
export function getPullRequestCommitRef(pullRequestNumber: number) {
  return `refs/pull/${pullRequestNumber}/head`
}

export class PullRequestRef {
  /**
   * @param ref The name of the ref.
   * @param sha The SHA of the ref.
   * @param gitHubRepository The GitHub repository in which this ref lives. It could be null if the
   *                         repository was deleted after the PR was opened.
   */
  public constructor(
    public readonly ref: string,
    public readonly sha: string,
    public readonly gitHubRepository: GitHubRepository
  ) {}
}

/**
 * A pull request's lifecycle state. `merged` is deliberately distinct from
 * `closed`: a board's final lane needs to tell "integrated" apart from
 * "abandoned", and a git client that only knows open-or-closed cannot.
 */
export type PullRequestState = 'open' | 'closed' | 'merged'

export class PullRequest {
  /**
   * @param created The date on which the PR was created.
   * @param status The status of the PR. This will be `null` if we haven't looked up its
   *               status yet or if an error occurred while looking it up.
   * @param title The title of the PR.
   * @param number The number.
   * @param head The ref from which the pull request's changes are coming.
   * @param base The ref which the pull request is targeting.
   * @param author The author's login.
   * @param state The lifecycle state: open, closed, or merged.
   * @param mergedAt When the PR was merged, or null if it was not.
   * @param closedAt When the PR was closed, or null if it is open.
   */
  public constructor(
    public readonly created: Date,
    public readonly title: string,
    public readonly pullRequestNumber: number,
    public readonly head: PullRequestRef,
    public readonly base: PullRequestRef,
    public readonly author: string,
    public readonly draft: boolean,
    public readonly body: string,
    public readonly state: PullRequestState = 'open',
    public readonly mergedAt: Date | null = null,
    public readonly closedAt: Date | null = null
  ) {}
}

/** The types of pull request suggested next actions */
export enum PullRequestSuggestedNextAction {
  PreviewPullRequest = 'PreviewPullRequest',
  CreatePullRequest = 'CreatePullRequest',
}

/** Type guard which narrows a string to a PullRequestSuggestedNextAction */
export function isIdPullRequestSuggestedNextAction(
  id: string
): id is
  | PullRequestSuggestedNextAction.PreviewPullRequest
  | PullRequestSuggestedNextAction.CreatePullRequest {
  return (
    id === PullRequestSuggestedNextAction.PreviewPullRequest ||
    id === PullRequestSuggestedNextAction.CreatePullRequest
  )
}

export const defaultPullRequestSuggestedNextAction =
  PullRequestSuggestedNextAction.PreviewPullRequest
