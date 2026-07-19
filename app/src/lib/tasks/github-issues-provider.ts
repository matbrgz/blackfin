import {
  ITask,
  ITaskAssignee,
  ITaskLabel,
  TaskKey,
  TaskProviderId,
} from '../../models/task'
import { IAPIIdentity, IAPIIssue } from '../api'
import { mapToTaskState } from './task-state'
import {
  attemptTaskProviderIO,
  ITaskProvider,
  ITaskProviderCapabilities,
  ITaskProviderContext,
  ITaskProviderError,
  ITaskProviderIdentity,
  ITaskProviderScope,
  ITaskProviderState,
  TaskProviderErrorCode,
  TaskProviderResult,
  taskProviderError,
  taskProviderOk,
} from './task-provider'

// The GitHub Issues provider (#73), refactored to implement the canonical
// `ITaskProvider` abstraction (#75).
//
// This file is the proof the abstraction holds: GitHub — the one concrete source
// that already exists — implements the same interface Linear/Jira/Projects will,
// with no contortion and no lying stub. It cannot write task state, so it sets
// `canWriteState: false` and simply omits `setState`; the interface does not force
// it to fake one (the opposite of `BitbucketAPI.fetchIssues()` returning `[]`).
//
// Two layers, as in #73:
//
//   1. A PURE mapping layer (`apiIssueToTask` and friends) — GitHub JSON in, an
//      internal `ITask`/identity/scope out. No network, no `Account`, no token.
//      Total: every historically-optional field defaults instead of throwing.
//
//   2. The provider itself — it delegates the actual REST/pagination to an
//      injected `IGitHubIssuesDataSource` and maps the result. The transport is
//      injected, not owned, so the provider is exercised in `node:test` against a
//      fake data source (including one that rejects, to prove it never throws) and
//      the real HTTP implementation is DEFERRED to the runtime slice with
//      `TasksStore`/`TasksDatabase`.
//
// The token never reaches this file's output: the mappers cannot see a credential,
// the data source authenticates the request and copies none of it into what it
// returns, and `ITask` has no credential-shaped field (#72).

/** The GitHub Issues provider's id, one source of truth for the mapper and class. */
export const GitHubIssuesProviderId = TaskProviderId.GitHubIssues

/**
 * A minimal GitHub repository descriptor for scope listing — the db id the scope
 * is keyed by and the name shown. Deliberately not `IAPIRepository`: the provider
 * needs only these two fields to build an `ITaskProviderScope`.
 */
export interface IGitHubRepositoryRef {
  readonly dbID: number
  readonly fullName: string
}

/**
 * The transport the GitHub Issues provider delegates to. This is the seam where
 * the network lives: the pure provider calls these, the real implementation
 * (REST, pagination, incremental `since`) is DEFERRED to the runtime slice, and
 * tests inject a fake — including one that rejects, to prove the provider turns a
 * failure into a result rather than throwing. An implementation authenticates
 * with the user's GitHub account and copies none of it into what it returns.
 */
export interface IGitHubIssuesDataSource {
  /** The authenticated user, for `validate()`. */
  fetchIdentity(): Promise<IAPIIdentity>
  /** The issues for a repository, optionally only those updated since a time. */
  fetchIssues(
    gitHubRepositoryID: number,
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>>
  /** A single issue by number, or null when it does not exist. */
  fetchIssue(
    gitHubRepositoryID: number,
    issueNumber: number
  ): Promise<IAPIIssue | null>
  /** The repositories the account can see, as scope candidates. */
  fetchRepositories(): Promise<ReadonlyArray<IGitHubRepositoryRef>>
}

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

/** Map an authenticated GitHub identity to the provider-agnostic identity. */
function apiIdentityToProviderIdentity(
  identity: IAPIIdentity
): ITaskProviderIdentity {
  return {
    externalId: identity.id.toString(),
    displayName: identity.login,
    avatarURL: identity.avatar_url.length > 0 ? identity.avatar_url : null,
  }
}

/** Map a repository descriptor to a selectable scope. */
function repositoryToScope(
  repository: IGitHubRepositoryRef
): ITaskProviderScope {
  return { id: repository.dbID.toString(), displayName: repository.fullName }
}

/** Best-effort read of an HTTP status off an unknown error, or undefined. */
function readHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const candidate = (error as { readonly status?: unknown }).status
  return typeof candidate === 'number' ? candidate : undefined
}

/**
 * Translate a caught transport failure into a provider error WITHOUT reading the
 * request or the credential — only an HTTP status (when the error carries one)
 * and the error's own message cross this boundary (#75). Anything unrecognized is
 * `Unavailable`, since a provider that did not answer is, from here, simply down.
 */
function gitHubErrorToProviderError(error: unknown): ITaskProviderError {
  const status = readHttpStatus(error)
  const message =
    error instanceof Error ? error.message : 'GitHub request failed'

  if (status === undefined) {
    return { code: TaskProviderErrorCode.Unavailable, message }
  }
  if (status === 401 || status === 403) {
    return {
      code: TaskProviderErrorCode.Unauthorized,
      message,
      httpStatus: status,
    }
  }
  if (status === 404) {
    return { code: TaskProviderErrorCode.NotFound, message, httpStatus: status }
  }
  if (status === 429) {
    return {
      code: TaskProviderErrorCode.RateLimited,
      message,
      httpStatus: status,
    }
  }
  return {
    code: TaskProviderErrorCode.Unavailable,
    message,
    httpStatus: status,
  }
}

/** The externalId half of a `${providerId}:${externalId}` task key (#72). */
function externalIdFromKey(key: TaskKey): string {
  const separator = key.indexOf(':')
  return separator === -1 ? key : key.slice(separator + 1)
}

const GitHubIssuesCapabilities: ITaskProviderCapabilities = {
  canReadTasks: true,
  // GitHub Issues is read-only here: no `setState`, so no lying claim it can write.
  canWriteState: false,
  incrementalRefresh: true,
  providesScopes: true,
  // It borrows the user's existing GitHub account rather than a keychain secret.
  usesGitAccount: true,
}

/**
 * GitHub Issues as an `ITaskProvider`. Read-only (no `setState`), incremental,
 * scope-aware, backed by the user's git account. All I/O is delegated to the
 * injected data source and wrapped so a rejection becomes a `{ ok: false }`
 * result — the provider never throws.
 */
export class GitHubIssuesProvider implements ITaskProvider {
  public readonly id = TaskProviderId.GitHubIssues
  public readonly capabilities = GitHubIssuesCapabilities

  public constructor(private readonly dataSource: IGitHubIssuesDataSource) {}

  public validate(): Promise<TaskProviderResult<ITaskProviderIdentity>> {
    return attemptTaskProviderIO(
      async () =>
        apiIdentityToProviderIdentity(await this.dataSource.fetchIdentity()),
      gitHubErrorToProviderError
    )
  }

  public async listTasks(
    context: ITaskProviderContext,
    since: Date | null
  ): Promise<TaskProviderResult<ReadonlyArray<ITask>>> {
    const gitHubRepositoryID = context.gitHubRepositoryID
    if (gitHubRepositoryID === null) {
      // A forge with no repository in focus has nothing to list — the honest
      // "nothing is mapped here", not an empty success and not a thrown error.
      return taskProviderError(
        TaskProviderErrorCode.NoScope,
        'No repository is in focus for the GitHub Issues provider.'
      )
    }

    return attemptTaskProviderIO(async () => {
      const issues = await this.dataSource.fetchIssues(
        gitHubRepositoryID,
        since
      )
      return issues.map(issue => apiIssueToTask(issue, gitHubRepositoryID))
    }, gitHubErrorToProviderError)
  }

  public async getTask(
    context: ITaskProviderContext,
    key: TaskKey
  ): Promise<TaskProviderResult<ITask>> {
    const gitHubRepositoryID = context.gitHubRepositoryID
    if (gitHubRepositoryID === null) {
      return taskProviderError(
        TaskProviderErrorCode.NoScope,
        'No repository is in focus for the GitHub Issues provider.'
      )
    }

    const issueNumber = parseInt(externalIdFromKey(key), 10)
    if (Number.isNaN(issueNumber)) {
      return taskProviderError(
        TaskProviderErrorCode.NotFound,
        `'${key}' is not a GitHub issue key.`
      )
    }

    return attemptTaskProviderIO(async () => {
      const issue = await this.dataSource.fetchIssue(
        gitHubRepositoryID,
        issueNumber
      )
      if (issue === null) {
        // A missing issue is a not-found result, not a thrown error — surfaced by
        // rejecting so the shared wrapper maps it once.
        const notFound: Error & { status?: number } = new Error(
          `Issue #${issueNumber} was not found.`
        )
        notFound.status = 404
        throw notFound
      }
      return apiIssueToTask(issue, gitHubRepositoryID)
    }, gitHubErrorToProviderError)
  }

  public listScopes(): Promise<
    TaskProviderResult<ReadonlyArray<ITaskProviderScope>>
  > {
    return attemptTaskProviderIO(
      async () =>
        (await this.dataSource.fetchRepositories()).map(repositoryToScope),
      gitHubErrorToProviderError
    )
  }

  public async listStates(
    _scopeId: string | null
  ): Promise<TaskProviderResult<ReadonlyArray<ITaskProviderState>>> {
    // GitHub issues are only ever `open` or `closed`, the same for every scope —
    // so this needs no I/O and cannot fail. Mapping through `mapToTaskState` keeps
    // the canonical reading in one place (#72).
    const states: ReadonlyArray<ITaskProviderState> = [
      {
        id: 'open',
        displayName: 'Open',
        taskState: mapToTaskState(TaskProviderId.GitHubIssues, 'open'),
      },
      {
        id: 'closed',
        displayName: 'Closed',
        taskState: mapToTaskState(TaskProviderId.GitHubIssues, 'closed'),
      },
    ]
    return taskProviderOk(states)
  }

  // Deliberately NO `setState`: GitHub Issues is read-only through this provider,
  // and the interface lets it simply not have the method rather than stub one.
}
