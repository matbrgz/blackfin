import { TaskProviderId } from './task'

// The persisted data model for a task provider connection (#75) — pure types
// only. The STORE that writes these (`TaskProvidersStore`, keychain, the Dexie
// `providerScopeMappings` table) is DEFERRED to a later slice; what lives here is
// the shape it will persist, kept pure so the security invariant — "no field of a
// connection is ever a secret" — is a type the tests can assert against with no
// store, no keychain and no network.

/** The last thing a provider said about a connection's credential. */
export enum TaskProviderConnectionState {
  /** The provider accepted the credential. */
  Connected = 'connected',
  /** The credential exists in the keychain but the provider rejected it. */
  Invalid = 'invalid',
  /** The connection's metadata exists but the keychain has no secret for it. */
  SecretMissing = 'secret-missing',
  /** No connection has been made. */
  NotConnected = 'not-connected',
}

/**
 * A configured connection to a provider, as persisted to `IDataStore`.
 *
 * It carries NO secret — not the API key, not a token, not a masked hint of one.
 * The credential lives only in the OS keychain (`ISecureStore`), is read at the
 * instant of a request and discarded, and is never a field of this object (#75
 * security section). The invariant test in `task-provider-store-invariants-test`
 * fails if any field name here matches `/token|secret|password|key|bearer/i`.
 */
export interface ITaskProviderConnection {
  readonly providerId: TaskProviderId
  /** The label the user sees, and half of the keychain key (with `providerId`). */
  readonly label: string
  /** Endpoint for self-hosted providers (Jira Server). Null for the SaaS ones. */
  readonly endpoint: string | null
  /** Who the credential says it is, from validation — never typed by the user. */
  readonly identityDisplayName: string | null
  readonly connectedAt: number
  readonly lastValidatedAt: number | null
  readonly lastValidationState: TaskProviderConnectionState
}

/**
 * The explicit, user-configured link from a repository to a provider scope
 * (Linear team, Jira project). This is the conscious antithesis of
 * `Account.computeApiType()` deriving a provider from a URL (#75): Blackfin does
 * not infer which team a repo belongs to from its name or its remote — nothing
 * reveals that — so it asks once and persists the answer. A repo with no mapping
 * for a provider is not a guess waiting to happen; it is simply not mapped.
 */
export interface ITaskProviderScopeMapping {
  /** The local `Repository.id`, the same stable per-repo anchor `ITaskLink` uses (#72). */
  readonly repositoryId: number
  readonly providerId: TaskProviderId
  /** The provider's own scope id (`ENG`, `PROJ`). */
  readonly scopeId: string
  readonly scopeDisplayName: string
}
