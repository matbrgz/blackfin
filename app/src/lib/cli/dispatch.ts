// The pure, no-I/O part of the CLI's command dispatch (#62). It takes the raw
// argv and the ambient facts an agent's shell hands the process — whether stdout
// is a TTY — and returns *what to do*: which command was named, whether to emit
// JSON or a human table, and whether the app may be contacted. The socket
// connect, the endpoint.json read, and the `process.stdout.write` are the CLI
// process's job (main.ts); keeping the decisions here means the contract an
// agent depends on — `--json` is the default without a TTY, `--schema-only`
// never touches the app, an unknown command is exit 2 — is unit-tested without
// spawning a process.
//
// It follows the same discipline as `client.ts`, `parse.ts` and `capabilities.ts`
// in this workspace: the complexity lives in a pure function, and that is where
// the tests are.

import { CLIErrorCode, ExitSuccess, exitCodeForError } from './protocol'
import type { ICapabilitiesDocument, ICLICommandSchema } from './capabilities'

/** How the output is rendered: machine JSON, or a human-readable table. */
export type CLIOutputFormat = 'json' | 'human'

/**
 * What the argv resolved to, before any I/O. `command` is the first positional
 * (the command name an agent typed), or `null` when none was given — the bare
 * `blackfin` invocation that opens the current directory. Everything else is the
 * decisions derived from the flags: the output format (JSON unless a TTY and no
 * explicit `--json`), whether `--schema-only` forbids touching the app, and
 * whether help was asked for.
 */
export interface IResolvedInvocation {
  readonly command: string | null
  readonly positionals: ReadonlyArray<string>
  readonly format: CLIOutputFormat
  readonly schemaOnly: boolean
  readonly help: boolean
}

/** The ambient facts the resolver needs, passed in so it stays pure. */
export interface IInvocationEnv {
  /** Whether stdout is a terminal. When false, JSON is the default output. */
  readonly stdoutIsTTY: boolean
}

/**
 * Read a boolean flag from a minimist-style parse without conflating "absent"
 * with "false". minimist yields `true` for `--flag`, `false` for `--no-flag`,
 * and leaves the key absent otherwise; only an explicit boolean counts.
 */
function explicitBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Resolve argv into the decisions the dispatcher acts on. Pure: it reads nothing
 * from the process, taking the TTY fact as input.
 *
 * `parsed` is the output of the CLI's argument parser (minimist) — passed in
 * rather than parsed here so the one parser configuration lives in main.ts and
 * this stays free of even that dependency. `_` is the positional list; `json`
 * and `schema-only` are the flags this layer cares about.
 */
export function resolveInvocation(
  parsed: {
    readonly _: ReadonlyArray<string | number>
    readonly json?: unknown
    readonly ['schema-only']?: unknown
    readonly help?: unknown
  },
  env: IInvocationEnv
): IResolvedInvocation {
  const positionals = parsed._.map(part => String(part))
  const command = positionals.length > 0 ? positionals[0] : null

  // `--json` / `--no-json` wins; absent, JSON is the default only without a TTY,
  // so a human at a terminal gets the table and a pipe or an agent gets JSON.
  const jsonFlag = explicitBoolean(parsed.json)
  const wantsJson = jsonFlag ?? !env.stdoutIsTTY

  const help = explicitBoolean(parsed.help) === true || command === 'help'

  return {
    command,
    positionals,
    format: wantsJson ? 'json' : 'human',
    schemaOnly: explicitBoolean(parsed['schema-only']) === true,
    help,
  }
}

/**
 * The outcome of running a command, reduced to what decides the exit code: it
 * succeeded, or it failed with one of the closed error codes. Keeping this a
 * value (not a thrown error) lets the exit-code mapping be tested directly.
 */
export type DispatchOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly code: CLIErrorCode }

/**
 * The process exit code for an outcome: success is 0, any error maps through the
 * shared error→exit table (#61). This is the whole point of the exit-code
 * contract — an agent branches on the number, never on the message.
 */
export function exitCodeForOutcome(outcome: DispatchOutcome): number {
  return outcome.kind === 'ok' ? ExitSuccess : exitCodeForError(outcome.code)
}

/** Truncate to `max` characters, appending an ellipsis when it had to cut. */
function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}

/** Right-pad with spaces to `width`; never truncates (widths are computed to fit). */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

const SUMMARY_WIDTH = 60

interface IRenderColumn {
  readonly header: string
  readonly cell: (command: ICLICommandSchema) => string
}

// The columns of the human table. `mutates`/`confirm`/`app` are the three facts
// an agent (or a human) most needs to see at a glance before calling — does it
// change anything, will a human be asked, does it need the app open.
const COLUMNS: ReadonlyArray<IRenderColumn> = [
  { header: 'COMMAND', cell: command => command.name },
  { header: 'MUTATES', cell: command => (command.mutates ? 'yes' : 'no') },
  { header: 'CONFIRM', cell: command => command.confirmation },
  { header: 'APP', cell: command => (command.requiresApp ? 'yes' : 'no') },
  {
    header: 'SUMMARY',
    cell: command => truncate(command.summary, SUMMARY_WIDTH),
  },
]

/**
 * Render the capabilities document as a human-readable table: a header with the
 * three versions and the app state, a row per command with its safety-relevant
 * flags and summary, then the global guardrails. Returns a string with `\n`
 * separators and no trailing newline (the caller adds one); no tabs or control
 * characters, so it lays out identically in any terminal.
 */
export function renderCapabilitiesTable(doc: ICapabilitiesDocument): string {
  const widths = COLUMNS.map(column =>
    doc.commands.reduce(
      (widest, command) => Math.max(widest, column.cell(command).length),
      column.header.length
    )
  )

  const renderRow = (cells: ReadonlyArray<string>): string =>
    cells
      .map((cell, index) => pad(cell, widths[index]))
      .join('  ')
      .replace(/\s+$/, '')

  const header = renderRow(COLUMNS.map(column => column.header))
  const rows = doc.commands.map(command =>
    renderRow(COLUMNS.map(column => column.cell(command)))
  )

  const appLine = doc.app.running
    ? `app: running (${doc.app.version ?? 'unknown version'})`
    : 'app: not running'

  const lines: Array<string> = [
    'Blackfin CLI — capabilities',
    `schema ${doc.schemaVersion} · protocol ${doc.protocolVersion} · cli ${doc.cliVersion}`,
    appLine,
    '',
    header,
    ...rows,
  ]

  if (doc.guardrails.length > 0) {
    lines.push('', 'Guardrails:')
    for (const guardrail of doc.guardrails) {
      lines.push(`  - ${guardrail}`)
    }
  }

  lines.push(
    '',
    'The machine-readable source of truth is: blackfin capabilities --json'
  )

  return lines.join('\n')
}

/**
 * Render the document in the requested format. JSON is pretty-printed with two
 * spaces — a single valid object, the envelope's `data` an agent parses. The
 * table is for a human at a terminal.
 */
export function renderCapabilities(
  doc: ICapabilitiesDocument,
  format: CLIOutputFormat
): string {
  return format === 'json'
    ? JSON.stringify(doc, null, 2)
    : renderCapabilitiesTable(doc)
}
