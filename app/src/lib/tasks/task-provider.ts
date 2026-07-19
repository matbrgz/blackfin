import { ITask, TaskKey, TaskProviderId, TaskState } from '../../models/task'

// The `ITaskProvider` abstraction (#75).
//
// #73 sketched a deliberately thin `ITaskProvider` inline — `fetchTasks` and a
// `{ ok } | { ok, error }` result — because at that point only one real source
// existed and abstracting an imaginary second one would have been guesswork.
// Now that a concrete provider exists to abstract *from*, this file canonicalizes
// that seam into the shape Linear/Jira/Projects (#77/#78/#80) will implement and
// makes the GitHub provider conform to the same interface instead of owning its
// own.
//
// Three things live here and nowhere else:
//
//   1. The RESULT TYPES. A provider is an I/O boundary, and the project's rule
//      for I/O boundaries (`docs/BRIEFING.md` §4, `workspace/scan.ts`) is that a
//      failure is a *value*, not an exception: a Linear that is down degrades the
//      Linear list, it does not throw the GitHub list off the screen. So every
//      method returns `TaskProviderResult<T>` and none of them is an
//      async-that-throws.
//
//   2. The CAPABILITY MODEL. A provider *declares* what it can do — read, write
//      state back, sync incrementally, offer selectable scopes, borrow the git
//      account — instead of stubbing a method it cannot honour. This is the
//      conscious opposite of `BitbucketAPI.fetchIssues()` returning `[]`
//      (`api.ts:3631`): a provider that cannot write does not lie that it can, it
//      simply sets `canWriteState: false` and omits `setState`.
//
//   3. The IDENTITY / KEYING vocabulary — `ITaskProviderIdentity`,
//      `ITaskProviderScope`, `ITaskProviderState`, `ITaskProviderContext` — the
//      small, provider-agnostic shapes the interface trades in. None of them
//      carries a credential: a provider must never be able to smuggle the secret
//      that authenticated a request back out through a task, an identity or a
//      scope (#72, #75 security section).
//
// PURE by construction: this file imports only the pure task domain (#72). It has
// no network, no store, no keychain — a provider *takes* its data (its injected
// transport) rather than owning one, so the whole abstraction is exercised in
// `node:test` with fakes and never touches a socket.

/**
 * Why a provider request failed, coarse enough to drive UI without a provider's
 * own error taxonomy leaking in. `NoScope` is the honest answer for a forge asked
 * to list tasks with no repository in context, or a non-forge with no mapped
 * scope — it is *not* an error to show as a failure, it is "nothing is mapped
 * here, and here is why" (#75).
 */
export enum TaskProviderErrorCode {
  /** The credential was rejected (HTTP 401/403). */
  Unauthorized = 'unauthorized',
  /** The credential is absent from the OS keychain. */
  SecretMissing = 'secret-missing',
  /** The requested task/scope does not exist (HTTP 404). */
  NotFound = 'not-found',
  /** The provider asked us to back off (HTTP 429). */
  RateLimited = 'rate-limited',
  /** A transport failure — the provider was unreachable. */
  Unavailable = 'unavailable',
  /** No repository/scope was supplied, so there is nothing to fetch. */
  NoScope = 'no-scope',
  /** Anything else, including a malformed response. */
  Unknown = 'unknown',
}

/**
 * A provider failure, as a value.
 *
 * There is deliberately no field for a request header, a request body or a
 * credential: an error is logged and shown, and neither path may ever carry the
 * secret that authenticated the failed request (#75 security section). Only the
 * provider's own `message` and, when there was one, the HTTP `status` cross this
 * boundary.
 */
export interface ITaskProviderError {
  readonly code: TaskProviderErrorCode
  /** The provider's own human-readable message. Never the request or the secret. */
  readonly message: string
  /** The HTTP status, when the failure came from a response. */
  readonly httpStatus?: number
}

/**
 * The outcome of any provider operation. `ok: true` carries the value; `ok:
 * false` carries the error. This is the canonical form of the `{ ok } | { ok,
 * error }` #73 introduced as `TaskFetchResult`, generalized over the payload so
 * `validate`, `listTasks`, `listScopes` and the rest all speak it.
 */
export type TaskProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ITaskProviderError }

/** Build a success result. */
export function taskProviderOk<T>(value: T): TaskProviderResult<T> {
  return { ok: true, value }
}

/** Build a failure result. */
export function taskProviderError<T>(
  code: TaskProviderErrorCode,
  message: string,
  httpStatus?: number
): TaskProviderResult<T> {
  const error: ITaskProviderError =
    httpStatus === undefined ? { code, message } : { code, message, httpStatus }
  return { ok: false, error }
}

/**
 * Run an injected I/O operation and turn any rejection into a failure result,
 * so the "a provider never throws" guarantee is honoured in exactly one place
 * instead of a try/catch smeared across every method. `mapError` translates a
 * caught value into an `ITaskProviderError` *without reading the request or the
 * secret* — it may inspect an HTTP status, never a header.
 */
export async function attemptTaskProviderIO<T>(
  operation: () => Promise<T>,
  mapError: (error: unknown) => ITaskProviderError
): Promise<TaskProviderResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: mapError(error) }
  }
}

/**
 * Who a credential says it is, from a successful `validate()`. This is what the
 * UI shows as "connected as *Fulano*" — never the credential itself (#75).
 */
export interface ITaskProviderIdentity {
  /** The provider's own id for this identity. */
  readonly externalId: string
  readonly displayName: string
  readonly avatarURL: string | null
}

/**
 * A selectable scope inside a provider: a GitHub repository, a Linear team, a
 * Jira project. The value a repo↔scope mapping (#75) points at.
 */
export interface ITaskProviderScope {
  /** The provider's own id for the scope (`ENG`, a repo db id as a string). */
  readonly id: string
  readonly displayName: string
}

/**
 * A workflow state a provider actually has — the thing that lets #79 refuse an
 * ambiguous write instead of guessing which remote column "Done" means.
 */
export interface ITaskProviderState {
  /** The provider's own id for the state, used as the target of `setState`. */
  readonly id: string
  /** The provider's own label, shown verbatim. */
  readonly displayName: string
  /** Blackfin's canonical reading of the state (#72). */
  readonly taskState: TaskState
}

/**
 * What a provider is being asked about. A forge (GitHub) locates work by its
 * repository; a non-forge (Linear/Jira) locates it by a mapped `scopeId`, since
 * it has no repository and no URL a repo maps to (#75). Both are nullable: a
 * cross-project view has no repository, and an unmapped repository has no scope —
 * and a provider answers such a context with a `NoScope` result, not a guess.
 */
export interface ITaskProviderContext {
  /**
   * The db id (`GitHubRepository.dbID`) of the repository in focus, or null in a
   * cross-project view. A plain id, not the `Repository` object, keeps this
   * abstraction free of the git-forge model layer — the concrete `Repository`
   * lives in the store/UI (#75), not in the pure provider seam.
   */
  readonly gitHubRepositoryID: number | null
  /** The mapped scope (Linear team, Jira project). Null for a forge or an unmapped repo. */
  readonly scopeId: string | null
}

/**
 * What a provider declares it can do. Read at the UI/store layer to decide which
 * actions to offer, so the interface never has to stub a capability it lacks.
 */
export interface ITaskProviderCapabilities {
  /** Can list and read tasks. */
  readonly canReadTasks: boolean
  /**
   * Can write a task's state back. MUST agree with the presence of `setState`
   * (`providerCanWriteState` proves it): a provider that sets this false and
   * omits the method is the whole point — no lying stub (#75).
   */
  readonly canWriteState: boolean
  /**
   * Honours the `since` argument to `listTasks` for an incremental refresh. When
   * false, `listTasks` ignores `since` and returns the full set.
   */
  readonly incrementalRefresh: boolean
  /** Exposes selectable scopes through `listScopes` (repos/teams/projects). */
  readonly providesScopes: boolean
  /**
   * Authenticates with the user's existing git account rather than a standalone
   * secret in the keychain. True for GitHub Issues (it borrows your GitHub
   * account), false for Linear/Jira (an API key that is not a git account, #75).
   */
  readonly usesGitAccount: boolean
}

/**
 * The abstraction every task source implements — a narrow, forge-agnostic seam
 * that is explicitly NOT a subclass of `API` and NOT an `Account` (#75). Each
 * method is required by a real feature, returns a `TaskProviderResult`, and never
 * throws.
 */
export interface ITaskProvider {
  /** Which provider this is, for keying (`${id}:${externalId}`, #72) and state mapping. */
  readonly id: TaskProviderId

  /** What this provider can do. See `ITaskProviderCapabilities`. */
  readonly capabilities: ITaskProviderCapabilities

  /** Validate the credential. The failure is a result, not an exception. */
  validate(): Promise<TaskProviderResult<ITaskProviderIdentity>>

  /**
   * List the tasks for a context, optionally only those updated at or after
   * `since` (honoured only when `capabilities.incrementalRefresh`). Resolves to a
   * result, never rejects.
   */
  listTasks(
    context: ITaskProviderContext,
    since: Date | null
  ): Promise<TaskProviderResult<ReadonlyArray<ITask>>>

  /**
   * Fetch a single task by key. Takes the context too because a `TaskKey`
   * (`${providerId}:${externalId}`, #72) is not self-locating for a forge —
   * GitHub's issue number is unique only within a repository, so the repository
   * has to come from somewhere, and that somewhere is the context, never a guess.
   */
  getTask(
    context: ITaskProviderContext,
    key: TaskKey
  ): Promise<TaskProviderResult<ITask>>

  /** The scopes available to this credential (repos/teams/projects). */
  listScopes(): Promise<TaskProviderResult<ReadonlyArray<ITaskProviderScope>>>

  /**
   * The workflow states this provider has for a scope (null for a provider whose
   * states do not vary by scope, like GitHub's open/closed). Feeds #79's refusal
   * to write an ambiguous state.
   */
  listStates(
    scopeId: string | null
  ): Promise<TaskProviderResult<ReadonlyArray<ITaskProviderState>>>

  /**
   * Write a task's state back. Present ONLY on providers that can write — a
   * read-only provider omits it entirely, and the UI asks for the method's
   * presence (or `providerCanWriteState`) before offering the action, rather than
   * calling a stub that lies (#75).
   */
  setState?(
    key: TaskKey,
    remoteStateId: string
  ): Promise<TaskProviderResult<void>>
}

/**
 * Whether a provider can genuinely write state — the capability flag and the
 * method presence must agree. This is the single check the UI and registry use,
 * so a provider that claims `canWriteState` but forgot `setState` (or vice
 * versa) is treated as read-only rather than crashing at the call site.
 */
export function providerCanWriteState(provider: ITaskProvider): boolean {
  return (
    provider.capabilities.canWriteState &&
    typeof provider.setState === 'function'
  )
}
