import { Account } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import {
  ITask,
  ITaskAssignee,
  ITaskLabel,
  TaskProviderId,
} from '../../models/task'
import { IAPIIdentity, IAPIIssue } from '../api'
import { mapToTaskState } from './task-state'

// The GitHub Issues provider (#73), split deliberately into two layers:
//
//   1. A PURE mapping layer (`apiIssueToTask`) — GitHub issue JSON in, an
//      internal `ITask` out. No network, no store, no `Account`, no token. It
//      is total: every field the fork historically left off `IAPIIssue` is
//      optional, so a payload missing `assignees`, `labels` or `body` maps to
//      empty arrays instead of throwing. That totality is what lets the runtime
//      store treat a bad payload as data, not an exception.
//
//   2. A runtime layer (`ITaskProvider.fetchTasks`) — the actual REST call,
//      pagination and incremental `since`. It is DEFERRED to the next slice
//      (see the note on `ITaskProvider` below); this file ships only the
//      contract for it plus the pure mapper it will delegate to.
//
// The token never reaches this file's output: the mapper cannot see an
// `Account`, and `ITask` has no credential-shaped field (#72). The runtime
// layer takes the `Account` only to authenticate the request, and copies none
// of it into the task it returns.

/**
 * The outcome of a provider fetch.
 *
 * A provider NEVER throws: a network, auth or parse failure is a *value*
 * (`{ ok: false }`), not an exception. The task list depends on this — a failed
 * refresh must fall back to the last cache with a staleness notice, never a
 * blank screen (#73 acceptance criteria).
 */
export type TaskFetchResult =
  | { readonly ok: true; readonly tasks: ReadonlyArray<ITask> }
  | { readonly ok: false; readonly error: string }

/**
 * The abstraction every task source normalizes behind — GitHub Issues today,
 * Linear/Jira/Projects when #75 lands. It is intentionally thin: fetch the
 * tasks for a repository since a point in time, and say so without throwing.
 *
 * The runtime GitHub implementation (the class that calls `API.fetchIssues` and
 * maps each result through `apiIssueToTask`) is DEFERRED to the following
 * increment together with `TasksStore`/`TasksDatabase`/`TasksUpdater`. This
 * interface and the pure mapper are the testable core that layer will build on.
 */
export interface ITaskProvider {
  /** Which provider this is, for keying and state mapping. */
  readonly id: TaskProviderId

  /**
   * Fetch the tasks for a repository, optionally only those updated since a
   * given time (the incremental refresh). Resolves to a result, never rejects.
   *
   * @param account    The authenticated account for the repository. Used only
   *                   to make the request; never copied into a returned task.
   * @param repository The GitHub repository whose issues to fetch.
   * @param since      Only fetch tasks updated at or after this time, or null
   *                   for a full fetch.
   */
  fetchTasks(
    account: Account,
    repository: GitHubRepository,
    since: Date | null
  ): Promise<TaskFetchResult>
}

/** The GitHub Issues provider's id, hoisted so the mapper and the (deferred)
 * runtime class agree on exactly one source of truth. */
export const GitHubIssuesProviderId = TaskProviderId.GitHubIssues

function mapAssignee(identity: IAPIIdentity): ITaskAssignee {
  return {
    externalId: identity.id.toString(),
    displayName: identity.login,
    // An empty avatar string is "no avatar", represented as null so the UI has
    // one thing to check, not two.
    avatarURL: identity.avatar_url.length > 0 ? identity.avatar_url : null,
  }
}

function mapLabel(label: {
  readonly name: string
  readonly color: string
}): ITaskLabel {
  return {
    name: label.name,
    // GitHub returns the hex without a leading `#`; keep it that way, and treat
    // an empty colour as "no colour" rather than an empty swatch.
    color: label.color.length > 0 ? label.color : null,
  }
}

/**
 * Map a single GitHub issue payload to Blackfin's internal `ITask`.
 *
 * PURE and TOTAL: no I/O, and it never throws — every field the fork used to
 * omit from `IAPIIssue` is optional and defaults sensibly (missing arrays
 * become empty, a missing `created_at` falls back to `updated_at`, a missing
 * `html_url` becomes an empty string). That is precisely the contract the
 * runtime store relies on to turn a malformed response into data, not a crash.
 *
 * The issue's `body` is deliberately NOT carried onto the task: an issue body
 * is untrusted third-party content (#72), fetched and rendered sandboxed by the
 * UI layer, never cached on the task by default.
 *
 * @param issue              The GitHub REST issue payload.
 * @param gitHubRepositoryID The db id of the repository the issue belongs to
 *                           (`GitHubRepository.dbID`). Named to obey the
 *                           project's ban on a bare `number` identifier.
 */
export function apiIssueToTask(
  issue: IAPIIssue,
  gitHubRepositoryID: number
): ITask {
  const issueNumber = issue.number

  const assignees = (issue.assignees ?? []).map(mapAssignee)
  const labels = (issue.labels ?? []).map(mapLabel)

  return {
    providerId: TaskProviderId.GitHubIssues,
    externalId: issueNumber.toString(),
    displayId: `#${issueNumber}`,
    title: issue.title,
    state: mapToTaskState(TaskProviderId.GitHubIssues, issue.state),
    // The tracker's own word, kept verbatim for display (#72).
    rawState: issue.state,
    assignees,
    labels,
    url: issue.html_url ?? '',
    updatedAt: issue.updated_at,
    // `createdAt` is required on `ITask`; a payload that predates the extended
    // type carries no `created_at`, so fall back to `updated_at` rather than
    // inventing a date or throwing.
    createdAt: issue.created_at ?? issue.updated_at,
    gitHubRepositoryID,
  }
}
