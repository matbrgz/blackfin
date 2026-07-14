// The CLI command registry (#61): one table that is at once the router and the
// source of the schema. A command that is not in this table does not exist — it
// is neither routable nor describable, which is precisely what keeps the
// published schema (#62) from drifting from the implementation.
//
// It is born with a single member, `ping`. #63 and #65 fill it in; #62
// serializes it. Resolution is exact — an unknown name routes to
// `unknown-command`, never to the "closest" command, because guessing what an
// agent meant is how a query silently runs the wrong thing.

import { CLIArgValue, CLIProtocolVersion } from './protocol'
import {
  buildCapabilities,
  CLISchemaVersion,
} from './capabilities'
import type {
  CLIConfirmation,
  CLIEffect,
  CLIStability,
  ICLIArgument,
  ICLIExample,
  ICLIFlag,
} from './capabilities'

/** What a command may touch, so the server can resolve `cwd` only as far as needed. */
export type CommandScope = 'none' | 'repository' | 'worktree'

/**
 * The context a command runs against, in the renderer. Kept minimal here; the
 * dispatcher (a later increment) supplies the concrete stores. A command reads
 * from it and returns plain data — it never executes anything the request named.
 */
export interface ICommandContext {
  readonly args: Readonly<Record<string, CLIArgValue>>
  /** The absolute, already-validated cwd the request arrived with. */
  readonly cwd: string
  /** Resolve the cwd to a repository the app already knows, or `null`. */
  readonly resolveRepository: () => Promise<ICommandRepository | null>
  /** Identifying facts about the running app, never a secret. */
  readonly app: ICommandAppInfo
}

export interface ICommandRepository {
  readonly name: string
  readonly gitDir: string
  readonly worktree: string | null
}

export interface ICommandAppInfo {
  readonly name: string
  readonly appVersion: string
  readonly pid: number
}

// The declarative fields are the schema (#62); `run` is the only field that is
// *not* published. Every effect field is required and without a default, so a
// descriptor that forgets to declare whether it mutates, or how it confirms,
// fails to compile — a command can never be silently marked safe by omission.
export interface ICommandDescriptor {
  readonly name: string
  readonly summary: string
  readonly description: string
  /** Whether running it changes state. `ping` does not; mutating commands are #65. */
  readonly mutates: boolean
  /** Whether a human must approve it. A mutating command is never `'none'` without a guardrail that says why. */
  readonly confirmation: CLIConfirmation
  /** Whether it needs the app running (every query does; only open/clone launch it). */
  readonly requiresApp: boolean
  readonly scope: CommandScope
  readonly stability: CLIStability
  /** The `schemaVersion` this command first appeared in. */
  readonly since: number
  readonly arguments: ReadonlyArray<ICLIArgument>
  readonly flags: ReadonlyArray<ICLIFlag>
  readonly effects: ReadonlyArray<CLIEffect>
  readonly exitCodes: ReadonlyArray<number>
  readonly examples: ReadonlyArray<ICLIExample>
  readonly guardrails: ReadonlyArray<string>
  /** The shape of the envelope's `data` on success, for the agent to expect. */
  readonly output: unknown
  readonly run: (ctx: ICommandContext) => Promise<unknown>
}

/**
 * `ping` — the smallest possible command, the end-to-end proof of the transport.
 * It reports identifying facts and the repository resolved from the cwd; it
 * reads nothing sensitive and mutates nothing.
 */
const ping: ICommandDescriptor = {
  name: 'ping',
  summary:
    'Check that the Blackfin app is reachable and see the resolved repository.',
  description:
    'Round-trips the transport and returns identifying facts about the app plus the repository resolved from the current directory. The smallest command; use it to confirm Blackfin is open before a query.',
  mutates: false,
  confirmation: 'none',
  requiresApp: true,
  scope: 'repository',
  stability: 'stable',
  since: CLISchemaVersion,
  arguments: [],
  flags: [],
  effects: ['reads-blackfin-state'],
  exitCodes: [0, 2, 3, 4, 5, 7],
  examples: [
    {
      cmd: 'blackfin ping --json',
      why: 'Confirm the app is reachable and see which repository this directory maps to.',
    },
  ],
  guardrails: [],
  output: {
    kind: 'object',
    fields: {
      app: 'string',
      appVersion: 'string',
      protocol: 'number',
      pid: 'number',
      cwd: 'string',
      repository: 'Repository | null',
    },
  },
  run: async ctx => {
    const repository = await ctx.resolveRepository()
    return {
      app: ctx.app.name,
      appVersion: ctx.app.appVersion,
      protocol: CLIProtocolVersion,
      pid: ctx.app.pid,
      cwd: ctx.cwd,
      repository,
    }
  },
}

// `capabilities` — the command that describes every command, itself included.
// It needs no app (the registry is compiled into the CLI), so `requiresApp` is
// false; the CLI answers it locally. When it *is* routed to a running app, this
// `run` builds the same document with the app's real version. It calls the
// local `allCommands()`, so the whole registry describes itself.
const capabilities: ICommandDescriptor = {
  name: 'capabilities',
  summary: 'Print the machine-readable schema of every Blackfin CLI command.',
  description:
    'Emits a single JSON document describing every command — arguments, types, effects, whether it mutates, whether a human must confirm, exit codes, examples, and the guardrails to read before acting. Derived from the command table, so it can never describe a command that does not exist. Works with the app closed.',
  mutates: false,
  confirmation: 'none',
  requiresApp: false,
  scope: 'none',
  stability: 'stable',
  since: CLISchemaVersion,
  arguments: [],
  flags: [
    {
      name: 'json',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Emit JSON (the default when there is no TTY).',
    },
    {
      name: 'schema-only',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Describe only; do not contact the app to fill app.running.',
    },
  ],
  effects: ['reads-blackfin-state'],
  exitCodes: [0, 2],
  examples: [
    {
      cmd: 'blackfin capabilities --json',
      why: 'Discover what you are allowed to do. Do this first.',
    },
  ],
  guardrails: [],
  output: {
    kind: 'object',
    fields: {
      schemaVersion: 'number',
      protocolVersion: 'number',
      cliVersion: 'string',
      commands: 'array<Command>',
    },
  },
  run: async ctx =>
    buildCapabilities(allCommands(), {
      cliVersion: ctx.app.appVersion,
      app: { running: true, version: ctx.app.appVersion },
      now: () => new Date(),
    }),
}

const COMMANDS: ReadonlyArray<ICommandDescriptor> = [ping, capabilities]

const COMMANDS_BY_NAME: ReadonlyMap<string, ICommandDescriptor> = new Map(
  COMMANDS.map(c => [c.name, c])
)

/** Every registered command, in registration order — the schema source for #62. */
export function allCommands(): ReadonlyArray<ICommandDescriptor> {
  return COMMANDS
}

/**
 * Resolve a command name to its descriptor. Exact match only: an unknown name
 * returns `null` (the caller answers `unknown-command`), never a near match.
 */
export function resolveCommand(name: string): ICommandDescriptor | null {
  return COMMANDS_BY_NAME.get(name) ?? null
}
