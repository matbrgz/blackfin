// The secret boundary for MCP configuration (#45).
//
// MCP config files are full of plaintext secrets — GITHUB_TOKEN, API keys,
// Postgres URLs with embedded passwords, Authorization headers. Blackfin reads
// those files, builds a model, persists it in a Dexie cache, and shows it on a
// screen that ends up in bug-report screenshots. Four leak surfaces — model,
// cache, log, screen — and one defence that works: the value never enters.
//
// The defence is not "mask it in the UI". A masked value still exists in the
// model, is serialized into IndexedDB, and is one console.log away from a leak.
// The defence is structural: the *type* has no field for the value. There is no
// path from the file to the cache that does not pass through this contract, and
// this contract cannot carry a value. Adding a `value` field here is not a
// feature — it is a security bug, and the canary test exists to catch it.

/**
 * How present a variable is — the only thing Blackfin reports about a secret.
 *
 * The string values are the product's own vocabulary, quoted verbatim from the
 * hard rule ("reported only as configurada, ausente, herdada or armazenada
 * externamente"). The member names are English so call sites read naturally.
 */
export enum EnvVarPresence {
  /** A non-empty value is set in the config file. Blackfin neither reads it nor keeps it. */
  Configured = 'configurada',
  /** The server asks for this variable and nothing we can see defines it. The only problem state. */
  Missing = 'ausente',
  /** Not in the file; the launching process's environment supplies it. Blackfin checked the name exists, not the value. */
  Inherited = 'herdada',
  /** The file points at a vault or an indirection. The value lives outside the file, by choice. */
  ExternallyStored = 'armazenada-externamente',
}

/** Where an externally-stored secret actually lives. Emphasis for the UI; never a value. */
export enum ExternalSecretSource {
  /** VS Code `inputs` — held in the editor's secret storage. */
  VsCodeInput = 'vscode-input',
  /** `bearer_token_env_var` / `env_keys` — indirection by name. */
  EnvVarIndirection = 'env-var-indirection',
  /** OS keychain / vault. */
  Keychain = 'keychain',
  Unknown = 'unknown',
}

/**
 * The *shape* of what a config file declares for a variable — never the value.
 *
 * This is what the parser (#43) is allowed to hand `classifyEnvVar`. The parser
 * sees the raw string; it extracts this shape and drops the string. `isEmpty`
 * is the single bit derived from the value that survives, and it is the minimum
 * needed to tell "configured" from "missing".
 */
export type DeclaredEnvValue =
  /** A string literal in the file. The parser knows it exists; it does not propagate it. */
  | { readonly kind: 'literal'; readonly isEmpty: boolean }
  /** `${FOO}` / `$FOO` — the file references another variable. */
  | { readonly kind: 'interpolation'; readonly referencedName: string }
  /** `${input:token}`, `bearer_token_env_var`, `env_keys`, `${env:FOO}` — the value lives elsewhere. */
  | {
      readonly kind: 'external-reference'
      readonly source: ExternalSecretSource
    }
  /** The server requires the variable but the file does not declare it. */
  | { readonly kind: 'declared-only' }

/**
 * Everything Blackfin retains about one environment variable.
 *
 * There is no `value`, deliberately. This is the boundary: a value cannot reach
 * the cache, a log, the UI, or a screenshot because it cannot be represented
 * here. If someone ever adds `value?: string`, compilation still passes — which
 * is exactly why `mcp-secrets-test.ts` carries a canary.
 */
export interface IMcpEnvVar {
  readonly name: string
  readonly presence: EnvVarPresence
  /** Whether the *name* looks sensitive. Visual emphasis only — never a data-retention decision. */
  readonly sensitive: boolean
  /** Set only when `presence` is `ExternallyStored`, to say where. */
  readonly externalSource?: ExternalSecretSource
}

/** A sanitized remote MCP URL: userinfo and query removed, credentials flagged. */
export interface ISanitizedMcpUrl {
  /** `scheme://host[:port]/path`, or `null` if the raw URL did not parse. */
  readonly url: string | null
  /** True if the raw URL carried userinfo or a query string — the UI warns about this. */
  readonly hadEmbeddedCredentials: boolean
}
