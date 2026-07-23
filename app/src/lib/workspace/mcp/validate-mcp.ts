/**
 * Structural validation of a normalized MCP server — the PURE core of issue #46.
 *
 * The issue draws one hard, ratified line. Structural validation is **free and
 * safe because it is READING**: an invalid transport, a `stdio` server with no
 * `command`, a remote server whose URL is not a URL, a required environment
 * variable that is absent — every one of these is a fact a reader can prove
 * without running anything. The *other* half — the connection test, which
 * executes the user's command (`npx -y …` downloads and runs arbitrary code) or
 * opens a network request to a third party — is NOT free: it is the exploit this
 * issue exists to prevent from hiding inside a scan. That half is deliberately
 * DEFERRED to the runtime follow-up and MUST NEVER run during a scan.
 *
 * Therefore this file is the pure half, and it obeys the module doctrine of
 * `normalize-mcp.ts`, `catalog.ts` and `parse.ts`:
 *   - PURE: no I/O, no `child_process`, no `fetch`, no `process.env`, no disk.
 *   - It NEVER throws. A nonsensical server is a RESULT (a finding), never an
 *     exception. `new URL` is the one throwing call and it is wrapped.
 *   - It NEVER reads, logs, persists or surfaces a secret VALUE. Findings carry
 *     only a stable code, a severity, a human message and a `subject` that is a
 *     NAME (a command or a variable) — never a value, and never the URL text,
 *     which can itself carry credentials in its userinfo or query.
 *
 * INPUTS AND WHY THEY ARE PASSED IN. The shipped `IMcpServer` (extension.ts, #21)
 * is a NORMALIZED, names-only model: its `transport` is already the constrained
 * `'stdio' | 'http' | 'sse'`, it carries no URL text (a URL can hold a secret, so
 * the model has no slot for one), and `envKeys` are NAMES only with no presence.
 * A pure validator cannot re-derive what the model deliberately dropped, so the
 * two structural facts it needs beyond the server are passed IN, as data:
 *   - `envVars`  — the names-only presence view from #45 (`IMcpEnvVar[]`), whose
 *                  type has NO field for a value. Presence is computed elsewhere
 *                  (it needs the environment); this fn only reads name + presence.
 *   - `url`      — the raw URL string, retained by the caller solely so it can be
 *                  parsed STRUCTURALLY here (`new URL`, never fetched) and then
 *                  never echoed into a finding.
 * Nothing here touches `process.env`; the env presence is a value handed in.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *   - `command-not-found` — resolving the command against the real PATH is
 *     read-only I/O (`lstat`), so it belongs to the I/O boundary, not to this
 *     pure fn. It is left to the runtime follow-up alongside the connection test.
 *   - The connection test itself — executing the command or opening the socket.
 *     Quoted invariant (issue #46): *"Blackfin não hospeda agentes e não cria
 *     processos em silêncio."* A scan is a read; this file only reads.
 *
 * WHAT READING CANNOT PROVE. This validator never asserts a server *works* — that
 * is knowable only by the connection test the user has not authorized here. It
 * reports what reading proves, and nothing more.
 */

import type { IMcpServer } from '../../../models/extension'
import { EnvVarPresence, IMcpEnvVar } from '../../../models/mcp'

/**
 * A stable, machine-readable code for one structural finding. Extends the
 * parser's warning list (`McpNormalizeWarningKind`, #43) rather than inventing a
 * second error mechanism; a validator finding is the same shape of fact, one
 * level richer. The runtime-only codes the issue also lists —
 * `command-not-found` (needs PATH I/O) — are absent by design (see file header).
 */
export type McpValidationCode =
  /** `transport` is not one of `stdio` | `http` | `sse`. */
  | 'unknown-transport'
  /** A `stdio` server declares both a `command` and a URL — which one runs? */
  | 'ambiguous-transport'
  /** A `stdio` server with no `command` cannot be launched. */
  | 'missing-command'
  /** A remote (`http`/`sse`) server with no URL cannot be reached. */
  | 'missing-url'
  /** A URL was declared but is not a structurally valid `http`/`https` URL. */
  | 'invalid-url'
  /** `args` is not an array of strings. */
  | 'invalid-args'
  /** The command is a package runner (`npx`/`uvx`/`bunx`): it exists to download
   *  and execute code that Blackfin has NOT verified and will NOT verify. */
  | 'command-is-a-runner'
  /** A required environment variable is absent — by NAME only, never a value. */
  | 'env-var-missing'

/** How sure we are the server is broken. `error` ⇒ it certainly will not start;
 *  `warning` ⇒ it may not, or a readable fact deserves attention. */
export type McpValidationSeverity = 'error' | 'warning'

/**
 * One structural finding. It carries no value of any kind: `subject` is the NAME
 * of the command or variable involved (never its value), and no field ever holds
 * the URL text (which can carry credentials). `message` is a human sentence that
 * is safe to show verbatim because it, too, contains only names.
 */
export interface IMcpValidationFinding {
  readonly code: McpValidationCode
  readonly severity: McpValidationSeverity
  /** A human-readable sentence. Contains only names — never a value or a URL. */
  readonly message: string
  /** The command or variable name this finding is about, or `null` when the
   *  finding is about the server as a whole. NEVER a value. */
  readonly subject: string | null
}

/**
 * The structural facts a pure validator needs beyond the normalized server —
 * each passed IN as data, never read from the environment or the disk here.
 */
export interface IMcpValidationContext {
  /**
   * The names-only environment presence view for this server (#45). Only `.name`
   * and `.presence` are read; `IMcpEnvVar` has no value field to read. Absent
   * variables (`EnvVarPresence.Missing`) become `env-var-missing` findings.
   */
  readonly envVars: ReadonlyArray<IMcpEnvVar>
  /**
   * The raw URL string the config declared for a remote server, retained by the
   * caller solely for STRUCTURAL validation here. Parsed with `new URL` only —
   * never fetched — and never placed into a finding. `null`/`undefined` means the
   * config declared no URL (⇒ `missing-url` for a remote transport).
   */
  readonly url?: string | null
}

/** The outcome of validating one server: its name and every finding, in a
 *  stable, deterministic order. An empty `findings` array means reading proved
 *  no structural problem — NOT that the server works. */
export interface IMcpValidationResult {
  readonly serverName: string
  readonly findings: ReadonlyArray<IMcpValidationFinding>
}

/** The known transports. A value outside this set is `unknown-transport`. */
const KnownTransports: ReadonlyArray<string> = ['stdio', 'http', 'sse']

/**
 * Package runners: they exist to fetch and execute a package chosen at call
 * time, so a runner that is present proves nothing about the package it will
 * download — which Blackfin has not verified and will not. Compared by basename,
 * case-insensitively, after stripping a Windows launcher suffix.
 */
const RunnerCommands: ReadonlyArray<string> = ['npx', 'uvx', 'bunx', 'pnpx']

/** The basename of a command path, with a `.exe`/`.cmd`/`.bat` suffix stripped.
 *  Pure string work — it never touches the filesystem. */
function commandBasename(command: string): string {
  const segments = command.split(/[/\\]/).filter(segment => segment.length > 0)
  const last = segments.length > 0 ? segments[segments.length - 1] : command
  return last.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
}

/** Whether a command is a known package runner. Pure; basename comparison only. */
function isRunnerCommand(command: string): boolean {
  return RunnerCommands.includes(commandBasename(command))
}

/** Whether every element of an unknown value is a string. Used to defend against
 *  an `args` that a loosely-built server smuggled past the type system. */
function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * Structurally validate a URL string WITHOUT fetching it. Returns `true` when it
 * parses and uses an `http`/`https` scheme. Never throws — `new URL` throwing is
 * caught and reported as "not valid". The URL text never leaves this function.
 */
function isStructurallyValidHttpUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/**
 * Validate one normalized MCP server structurally and return every readable
 * problem as a finding. PURE: no I/O, no `process.env`, deterministic, and it
 * NEVER throws. It NEVER asserts the server works, and no finding ever contains
 * an environment value or the URL text.
 *
 * The findings it can produce:
 *   - `unknown-transport`   (error)   — transport not stdio/http/sse
 *   - `missing-command`     (error)   — stdio with no command
 *   - `invalid-args`        (error)   — args not an array of strings
 *   - `command-is-a-runner` (warning) — command is npx/uvx/bunx/pnpx
 *   - `missing-url`         (error)   — http/sse with no URL provided
 *   - `invalid-url`         (error)   — URL provided but not a valid http(s) URL
 *   - `ambiguous-transport` (warning) — a command AND a URL both declared
 *   - `env-var-missing`     (warning) — a required variable is absent (by name)
 */
export function validateMcpServer(
  server: IMcpServer,
  context: IMcpValidationContext
): IMcpValidationResult {
  const findings: IMcpValidationFinding[] = []

  const transport: string = server.transport
  const isKnownTransport = KnownTransports.includes(transport)
  const command =
    typeof server.command === 'string' && server.command.trim().length > 0
      ? server.command
      : null
  const rawUrl = context.url ?? null
  const hasUrl = typeof rawUrl === 'string' && rawUrl.trim().length > 0

  // Transport must be one of the three known values. A value outside the set is
  // reported and no transport-specific checks run — we cannot know what shape a
  // server of an unknown transport should have.
  if (!isKnownTransport) {
    findings.push({
      code: 'unknown-transport',
      severity: 'error',
      message:
        'Transport is not one of stdio, http, or sse, so this server cannot be launched.',
      subject: null,
    })
  } else if (transport === 'stdio') {
    if (command === null) {
      findings.push({
        code: 'missing-command',
        severity: 'error',
        message:
          'A stdio server must declare a command to run, but none is set.',
        subject: null,
      })
    } else {
      if (!isStringArray(server.args)) {
        findings.push({
          code: 'invalid-args',
          severity: 'error',
          message: 'args must be an array of strings.',
          subject: null,
        })
      }
      if (isRunnerCommand(command)) {
        findings.push({
          code: 'command-is-a-runner',
          severity: 'warning',
          message:
            `${commandBasename(
              command
            )} is a package runner: it downloads and runs a ` +
            'package that Blackfin has not verified and will not verify.',
          subject: commandBasename(command),
        })
      }
      // A stdio server that ALSO declares a URL is ambiguous: reading cannot tell
      // which one the user meant to be authoritative.
      if (hasUrl) {
        findings.push({
          code: 'ambiguous-transport',
          severity: 'warning',
          message:
            'This stdio server also declares a URL; a server should be either a ' +
            'command or a remote endpoint, not both.',
          subject: null,
        })
      }
    }
  } else {
    // Remote transport: http or sse. It needs a structurally valid http(s) URL.
    if (!hasUrl) {
      findings.push({
        code: 'missing-url',
        severity: 'error',
        message:
          'A remote server must declare a URL to connect to, but none is set.',
        subject: null,
      })
    } else if (!isStructurallyValidHttpUrl(rawUrl!)) {
      findings.push({
        code: 'invalid-url',
        severity: 'error',
        // The URL text is deliberately NOT included — it can carry credentials.
        message:
          'The declared URL is not a valid http or https URL, so it cannot be reached.',
        subject: null,
      })
    }
    // A remote server that ALSO declares a command is ambiguous.
    if (command !== null) {
      findings.push({
        code: 'ambiguous-transport',
        severity: 'warning',
        message:
          'This remote server also declares a command; a server should be either ' +
          'a command or a remote endpoint, not both.',
        subject: null,
      })
    }
  }

  // A required variable that is absent is the single most common reason a server
  // that is otherwise well-formed still fails to start. Reported by NAME only —
  // `IMcpEnvVar` has no value to leak.
  for (const envVar of context.envVars) {
    if (envVar.presence === EnvVarPresence.Missing) {
      findings.push({
        code: 'env-var-missing',
        severity: 'warning',
        message: `Required environment variable ${envVar.name} is absent.`,
        subject: envVar.name,
      })
    }
  }

  return { serverName: server.name, findings }
}
