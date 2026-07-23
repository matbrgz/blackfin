/**
 * MCP server details — the pure derivation for issue #44.
 *
 * Given a normalized MCP server (from #43's `parseMcpConfig`, model
 * `IMcpServer` in `models/extension.ts`) plus the set of parsed configs across
 * every agent and project, this module derives the "details" view-model the UI
 * renders: transport, execution (command/args or url), the env variable NAMES,
 * the consumers that reference the same server, and the projects the server
 * reaches.
 *
 * This module is PURE, in the same doctrine as `normalize-mcp.ts`: no I/O, no
 * `child_process`, no `fetch`, deterministic, and it NEVER throws. Empty,
 * partial, or nonsensical input is a well-formed RESULT (an empty details
 * view-model), never an exception. Blackfin OBSERVES MCP configs; nothing here
 * connects to, launches, or tests a server — that is issue #46 and lives
 * elsewhere.
 *
 * SECURITY INVARIANT (hard, #45): a secret value NEVER appears in the output.
 * The guarantee is structural, not a UI afterthought: the input `IMcpServer`
 * carries only `envKeys` (NAMES), has no field for an env value, and no field
 * for a URL — so the details view-model has nothing to leak. `envKeys` here is
 * copied through as names only. A URL is deliberately NOT surfaced for remote
 * transports: `IMcpServer` retains none (userinfo/query are secrets; URL
 * sanitisation, `ISanitizedMcpUrl`, is #45's separate concern), so `url` is
 * always `null` from this slice rather than re-parsed from raw. The canary test
 * plants a token in an env VALUE and asserts it never reaches this output.
 */

import { AgentId, ContextScope } from '../../../models/workspace-inventory'
import type { IMcpServer } from '../../../models/extension'

/**
 * The execution surface of a server, discriminated by transport.
 *
 * `stdio` carries the command and its args exactly as normalized — never
 * re-parsed, never truncated (the args are what the server can see). `http` and
 * `sse` are remote; their `url` is `null` because the normalized model does not
 * retain a URL (a #45 security posture — a raw URL can carry userinfo/query).
 */
export type IMcpTransportDetails =
  | {
      readonly transport: 'stdio'
      readonly command: string
      readonly args: ReadonlyArray<string>
    }
  | { readonly transport: 'http'; readonly url: string | null }
  | { readonly transport: 'sse'; readonly url: string | null }

/**
 * One agent config that declares this same server. The identity match is by
 * fingerprint (name + normalized command/args or transport), so the same
 * logical server declared by two agents yields two consumers, not two servers.
 *
 * `declaredName` is the name that agent chose for the server (an alias) — never
 * a value. `configPath` is the file that declares it (`IMcpServer.declaredIn`).
 */
export interface IMcpConsumer {
  readonly agent: AgentId
  readonly scope: ContextScope
  /** Absolute path of the config file that declares this server. */
  readonly configPath: string
  /** The name this agent gave the server. An alias, never a secret. */
  readonly declaredName: string
  /** The repository this config belongs to, or `null` for a global/home config. */
  readonly repositoryPath: string | null
  /** Whether this agent has the server disabled, when the dialect says so. */
  readonly disabled: boolean
}

/**
 * A project the server reaches, and why.
 *
 * A `Project`-scope consumer affects its own repository (`project-config`). A
 * `Global`-scope consumer affects EVERY known repository (`global-scope`) —
 * exactly the blast radius no single agent reports. When both bring the same
 * repository, the more specific origin (`project-config`) is the one reported.
 */
export interface IAffectedProject {
  readonly repositoryPath: string
  readonly via: 'project-config' | 'global-scope'
  /** The consumer that brought this project into range. */
  readonly consumer: IMcpConsumer
}

/**
 * One config entry to consider as a potential consumer: a normalized server
 * plus the agent/scope/repository that the file-discovery layer attached to it.
 * The scope and repository are NOT inferred here (that would be re-deriving
 * provenance); the caller supplies them from the scan pipeline.
 */
export interface IMcpConsumerConfig {
  readonly server: IMcpServer
  readonly agent: AgentId
  readonly scope: ContextScope
  /** The repository this config belongs to, or `null` for a global/home config. */
  readonly repositoryPath: string | null
  /** Whether this agent declares the server disabled. Defaults to enabled. */
  readonly disabled?: boolean
}

/** The derived details view-model for one MCP server. */
export interface IMcpServerDetails {
  /** The server's display/logical name. */
  readonly name: string
  /** Transport plus the execution surface (command/args or url). */
  readonly execution: IMcpTransportDetails
  /** Env variable NAMES only. There is no code path to a value here (#45). */
  readonly envKeys: ReadonlyArray<string>
  /** Every agent config that declares this same server, deduped. */
  readonly consumers: ReadonlyArray<IMcpConsumer>
  /** The distinct projects the server reaches, most-specific origin per repo. */
  readonly affectedProjects: ReadonlyArray<IAffectedProject>
}

/**
 * The logical identity of a server: what makes two declarations "the same
 * server" for consumer matching. Structural — name plus the execution surface —
 * and it deliberately excludes env, cwd and enabled state (those are per-
 * consumer facts, and divergence in them is reported, not merged). Carries no
 * value: `envKeys` are names and no URL is ever read.
 */
export function mcpServerFingerprint(server: IMcpServer): string {
  if (server.transport === 'stdio') {
    const command = server.command ?? ''
    return ['stdio', server.name, command, ...server.args].join(' ')
  }
  // Remote: no URL is retained, so identity is name + transport only.
  return [server.transport, server.name].join(' ')
}

/** Derive the execution surface from a normalized server. */
function executionOf(server: IMcpServer): IMcpTransportDetails {
  if (server.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: server.command ?? '',
      args: server.args,
    }
  }
  // `http` | `sse`: url is never surfaced from this slice (see file header).
  return { transport: server.transport, url: null }
}

/** A stable key for consumer deduplication. */
function consumerKey(consumer: IMcpConsumer): string {
  return [
    consumer.agent,
    consumer.scope,
    consumer.configPath,
    consumer.declaredName,
    consumer.repositoryPath ?? '',
  ].join(' ')
}

/**
 * Derive the full details view-model for `target` given every parsed config
 * across agents and projects, plus the paths of every known repository (the
 * blast radius for global-scope consumers). PURE; never throws; surfaces no
 * secret value — `envKeys` are names and no URL is read.
 */
export function deriveMcpServerDetails(
  target: IMcpServer,
  configs: ReadonlyArray<IMcpConsumerConfig>,
  allRepositoryPaths: ReadonlyArray<string>
): IMcpServerDetails {
  const fingerprint = mcpServerFingerprint(target)

  // Consumers: every config whose server shares the target's identity, deduped.
  const consumers: IMcpConsumer[] = []
  const seenConsumers = new Set<string>()
  for (const config of configs) {
    if (mcpServerFingerprint(config.server) !== fingerprint) {
      continue
    }
    const consumer: IMcpConsumer = {
      agent: config.agent,
      scope: config.scope,
      configPath: config.server.declaredIn,
      declaredName: config.server.name,
      repositoryPath: config.repositoryPath,
      disabled: config.disabled ?? false,
    }
    const key = consumerKey(consumer)
    if (seenConsumers.has(key)) {
      continue
    }
    seenConsumers.add(key)
    consumers.push(consumer)
  }

  const affectedProjects = rollUpAffectedProjects(consumers, allRepositoryPaths)

  return {
    name: target.name,
    execution: executionOf(target),
    // Names only. `IMcpServer` has no value field; nothing to strip.
    envKeys: target.envKeys,
    consumers,
    affectedProjects,
  }
}

/**
 * Roll consumers up into the distinct projects they reach. A project-scope
 * consumer affects its own repository; a global-scope consumer affects every
 * known repository. Distinct by repository, and `project-config` wins over
 * `global-scope` for a repository reached by both. A disabled consumer does not
 * bring a project into range (but is still listed as a consumer upstream).
 */
function rollUpAffectedProjects(
  consumers: ReadonlyArray<IMcpConsumer>,
  allRepositoryPaths: ReadonlyArray<string>
): ReadonlyArray<IAffectedProject> {
  const byRepo = new Map<string, IAffectedProject>()

  const consider = (candidate: IAffectedProject): void => {
    const existing = byRepo.get(candidate.repositoryPath)
    if (existing === undefined) {
      byRepo.set(candidate.repositoryPath, candidate)
      return
    }
    // Most specific origin wins: project-config beats global-scope.
    if (existing.via === 'global-scope' && candidate.via === 'project-config') {
      byRepo.set(candidate.repositoryPath, candidate)
    }
  }

  for (const consumer of consumers) {
    if (consumer.disabled) {
      continue
    }
    if (consumer.scope === ContextScope.Project) {
      if (consumer.repositoryPath !== null) {
        consider({
          repositoryPath: consumer.repositoryPath,
          via: 'project-config',
          consumer,
        })
      }
      continue
    }
    // Global scope: reaches every known repository.
    for (const repositoryPath of allRepositoryPaths) {
      consider({ repositoryPath, via: 'global-scope', consumer })
    }
  }

  return [...byRepo.values()]
}
