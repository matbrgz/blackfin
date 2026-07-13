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

// The documented sensitivity heuristic. It is *emphasis only*: it never decides
// what is retained — nothing is, for any variable — so a miss here is a missing
// lock icon, never a leaked value. Two tiers keep it from both under- and
// over-matching:
//
//  - Strong words (`TOKEN`, `SECRET`, `PASSWORD`/`PASSWD`, `CREDENTIAL`,
//    `APIKEY`, `AUTHORIZATION`, `AUTHENTICATION`) are unambiguous, so they match
//    anywhere in the name — `GITHUBTOKEN` and `X_AUTHORIZATION` count, not only
//    `_`-separated suffixes.
//  - Short/ambiguous words (`KEY`, `DSN`, `PAT`, and bare `AUTH`) match only on
//    a `_` or ends boundary, so `MONKEY`, `KEYBOARD`, `PATH` and — importantly
//    in a git tool — `GIT_AUTHOR_NAME` do not trip them, while `AUTH_TOKEN` and
//    `AUTH` still do.
const SENSITIVE_WORD =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|AUTHORIZATION|AUTHENTICATION)/
const SENSITIVE_BOUNDED = /(^|_)(KEY|DSN|PAT|AUTH)($|_)/

/** Whether a variable's *name* looks sensitive. Visual emphasis only. */
export function isSensitiveName(name: string): boolean {
  const upper = name.toUpperCase()
  return SENSITIVE_WORD.test(upper) || SENSITIVE_BOUNDED.test(upper)
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

// A placeholder for a redacted path segment. Fixed text, never an excerpt of the
// segment it replaces.
const RedactedSegment = '[redacted]'

/**
 * Whether a single path segment looks like an embedded credential.
 *
 * Deploy hooks, webhook URLs and path-style API keys put the secret straight in
 * the path (`.../services/T0/B0/<token>`, `.../v1/keys/<token>`), so the path is
 * a credential location as real as the query string. We cannot read a segment to
 * know, so we go by shape: any segment of 20+ chars (regardless of character
 * class — long opaque *and* long single-case both redact, so a 35-char org slug
 * or a UUID gets `[redacted]` too), or a 16–19 char one mixing two of lower/
 * upper/digit the way tokens do. Ordinary short route words — `services`,
 * `messages`, `my-workspace` — are spared. As with the query string we err
 * toward redacting: a spurious `[redacted]` is cheap; a leaked token is the one
 * thing this boundary exists to prevent. The residual gap is deliberate: a token
 * under 16 chars, or 16–19 chars of a single class, is not caught — widening
 * further would redact too many ordinary segments.
 */
function looksLikeSecretSegment(segment: string): boolean {
  if (segment.length >= 20) {
    return true
  }
  if (segment.length < 16) {
    return false
  }
  const classes =
    (/[a-z]/.test(segment) ? 1 : 0) +
    (/[A-Z]/.test(segment) ? 1 : 0) +
    (/[0-9]/.test(segment) ? 1 : 0)
  return classes >= 2
}

/**
 * Strip credentials from a remote MCP URL: remove userinfo and the entire query
 * string (and the fragment), redact credential-shaped path segments, and keep
 * `scheme://host[:port]/path`.
 *
 * A query string in an MCP endpoint URL is almost always a token, and we cannot
 * tell a credential parameter from a benign one without reading it — so any
 * query is treated as credential-bearing and flagged. The same reasoning applies
 * to the path: a token embedded in it is redacted, per `looksLikeSecretSegment`.
 * Erring toward a spurious "this URL contained credentials" note is far cheaper
 * than letting a token through, which is the worst place a token can be.
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

  // `pathname` carries the leading slash; splitting it yields an empty first
  // element we map over harmlessly. Rejoining preserves the original structure.
  let hadPathCredential = false
  const path = parsed.pathname
    .split('/')
    .map(segment => {
      if (looksLikeSecretSegment(segment)) {
        hadPathCredential = true
        return RedactedSegment
      }
      return segment
    })
    .join('/')

  // `host` already carries `[:port]`.
  const sanitized = `${parsed.protocol}//${parsed.host}${path}`

  return {
    url: sanitized,
    hadEmbeddedCredentials:
      hadUserinfo || hadQuery || hadFragment || hadPathCredential,
  }
}
