// The MCP secret boundary, as pure functions (#45).
//
// Everything here is pure and injectable. `classifyEnvVar` computes a presence
// from the *shape* a config file declared — never the value; the value has
// already been dropped by the time it reaches here, and the input type
// (`DeclaredEnvValue`) has no room for it. `sanitizeMcpUrl` strips credentials
// from a URL. Nothing in this file reads a secret, and nothing in it can return
// one.

import {
  DeclaredEnvValue,
  EnvVarPresence,
  IMcpEnvVar,
  ISanitizedMcpUrl,
} from '../../../models/mcp'

// The documented sensitivity heuristic: a suffix of `_TOKEN`, `_KEY`, `_SECRET`,
// `_PASSWORD`, `_CREDENTIALS` or `_DSN` (or the bare word), or an `AUTH` prefix.
// It is *emphasis only*. It never decides what is retained — nothing is, for any
// variable — so a miss here is a missing lock icon, never a leaked value.
const SENSITIVE_SUFFIX = /(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS|DSN)$/

/** Whether a variable's *name* looks sensitive. Visual emphasis only. */
export function isSensitiveName(name: string): boolean {
  const upper = name.toUpperCase()
  return SENSITIVE_SUFFIX.test(upper) || upper.startsWith('AUTH')
}

/**
 * Classify one environment variable by presence, from the shape the file
 * declared and a check of whether a name exists in the environment.
 *
 * `environmentHasName` is injected — a `Set` in tests, `n => process.env[n] !==
 * undefined` in production. Note the `!== undefined`: it asks whether the *key*
 * exists, and never reads the value. `process.env` is never copied anywhere.
 */
export function classifyEnvVar(
  name: string,
  declared: DeclaredEnvValue,
  environmentHasName: (name: string) => boolean
): IMcpEnvVar {
  const sensitive = isSensitiveName(name)

  switch (declared.kind) {
    case 'literal':
      return {
        name,
        sensitive,
        presence: declared.isEmpty
          ? EnvVarPresence.Missing
          : EnvVarPresence.Configured,
      }

    case 'interpolation':
      return {
        name,
        sensitive,
        presence: environmentHasName(declared.referencedName)
          ? EnvVarPresence.Inherited
          : EnvVarPresence.Missing,
      }

    case 'external-reference':
      return {
        name,
        sensitive,
        presence: EnvVarPresence.ExternallyStored,
        externalSource: declared.source,
      }

    case 'declared-only':
      return {
        name,
        sensitive,
        presence: environmentHasName(name)
          ? EnvVarPresence.Inherited
          : EnvVarPresence.Missing,
      }
  }
}

/**
 * Strip credentials from a remote MCP URL: remove userinfo and the entire query
 * string (and the fragment), keep `scheme://host[:port]/path`.
 *
 * A query string in an MCP endpoint URL is almost always a token, and we cannot
 * tell a credential parameter from a benign one without reading it — so any
 * query is treated as credential-bearing and flagged. Erring toward a spurious
 * "this URL contained credentials" note is far cheaper than letting a token
 * through in a query string, which is the worst place a token can be.
 */
export function sanitizeMcpUrl(raw: string): ISanitizedMcpUrl {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    // Unparseable: no URL to show, and — critically — no excerpt of the raw
    // string, which may itself be the credential.
    return { url: null, hadEmbeddedCredentials: false }
  }

  const hadUserinfo = parsed.username !== '' || parsed.password !== ''
  const hadQuery = parsed.search !== ''
  const hadFragment = parsed.hash !== ''

  // `host` already carries `[:port]`; `pathname` carries the leading slash.
  const sanitized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`

  return {
    url: sanitized,
    hadEmbeddedCredentials: hadUserinfo || hadQuery || hadFragment,
  }
}
