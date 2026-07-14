// The CLI command registry (#61): one table that is at once the router and the
// source of the schema. A command that is not in this table does not exist — it
// is neither routable nor describable, which is precisely what keeps the
// published schema (#62) from drifting from the implementation.
//
// It is born with a single member, `ping`. #63 and #65 fill it in; #62
// serializes it. Resolution is exact — an unknown name routes to
// `unknown-command`, never to the "closest" command, because guessing what an
// agent meant is how a query silently runs the wrong thing.

import { CLIArgValue } from './protocol'

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

export interface ICommandDescriptor {
  readonly name: string
  readonly summary: string
  /** Whether running it changes state. `ping` does not; mutating commands are #65. */
  readonly mutates: boolean
  /** Whether it needs the app running (every query does; only open/clone launch it). */
  readonly requiresApp: boolean
  readonly scope: CommandScope
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
  mutates: false,
  requiresApp: true,
  scope: 'repository',
  run: async ctx => {
    const repository = await ctx.resolveRepository()
    return {
      app: ctx.app.name,
      appVersion: ctx.app.appVersion,
      protocol: 1,
      pid: ctx.app.pid,
      cwd: ctx.cwd,
      repository,
    }
  },
}

const COMMANDS: ReadonlyArray<ICommandDescriptor> = [ping]

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
