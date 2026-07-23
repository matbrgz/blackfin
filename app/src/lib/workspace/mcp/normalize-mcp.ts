/**
 * MCP configuration normalization — the pure, testable core of issue #43.
 *
 * This module is PURE: no I/O, no `child_process`, no `fetch`, deterministic,
 * and it NEVER throws. A malformed file, an unknown shape, or a nonsensical
 * entry is a RESULT (a warning), never an exception — the same doctrine as
 * `catalog.ts` and `parse.ts`. The file-discovery/reading boundary (the scanner
 * I/O — reuse the existing scan pipeline), the opt-in connection test (#46),
 * the UI (#44) and the TOML/YAML dialects (Codex `config.toml`, etc.) are
 * DEFERRED and live elsewhere; this file only turns the RAW TEXT of a JSON MCP
 * config into normalized servers.
 *
 * SECURITY INVARIANT (hard, #45): MCP configs routinely carry secrets in `env`
 * (and in URL userinfo/query). This code reads only the KEYS (names) of any
 * `env` object into `IMcpServer.envKeys`; it NEVER reads, copies, logs, or
 * returns an env VALUE. `IMcpServer` (reused from `extension.ts`, #21) has no
 * field for a value, no field for a URL, and no field for a header value — so a
 * secret cannot be filled in by mistake. Warnings carry a `configPath` and a
 * declared NAME (a map key, an alias — never a value) and never an excerpt of
 * the file content, because an error that echoes the offending line is a leak
 * wearing a diagnostic's clothes. (The richer per-variable presence model and
 * URL sanitisation live in `models/mcp.ts` + `mcp/secrets.ts`, #45; this slice
 * needs none of a value, so it stores none.)
 */

import { AgentId } from '../../../models/workspace-inventory'
import type { IMcpServer } from '../../../models/extension'

/**
 * The JSON dialects this pure core understands. Each names a root key and a
 * per-entry shape. TOML/YAML dialects (Codex) are deferred — see file header.
 */
export enum McpConfigFormat {
  /**
   * Root `mcpServers` object (and `projects[<path>].mcpServers`): Claude,
   * Cursor, Gemini.
   */
  McpServersMap = 'mcp-servers-map',
  /** Root `servers` object plus a separate `inputs` list: VS Code. */
  VsCodeServers = 'vscode-servers',
  /**
   * Root `mcp` object with `local`/`remote` entries; `command` is an array of
   * strings rather than a string plus `args`: OpenCode.
   */
  OpenCodeMcp = 'opencode-mcp',
}

/**
 * What went wrong with one entry, or with the file as a whole. Never a value,
 * never a content excerpt.
 */
export type McpNormalizeWarningKind =
  | 'empty'
  | 'malformed-json'
  | 'unrecognized-shape'
  | 'invalid-entry'
  | 'unknown-transport'
  | 'missing-command'
  | 'missing-url'

/**
 * A single problem, safe to surface in the UI. `declaredName` is the server's
 * map key (an alias the agent chose), NOT a secret; it is `null` for
 * file-level problems. There is deliberately NO field for the offending text.
 */
export interface IMcpNormalizeWarning {
  readonly kind: McpNormalizeWarningKind
  readonly configPath: string
  /** The name the config gave this entry, when the problem is entry-scoped. */
  readonly declaredName: string | null
}

/**
 * The outcome of normalizing one config file: the servers it declares, plus
 * every per-entry and file-level warning.
 */
export interface IMcpNormalizeResult {
  readonly servers: ReadonlyArray<IMcpServer>
  readonly warnings: ReadonlyArray<IMcpNormalizeWarning>
}

/**
 * How to interpret the raw text: which file it came from (becomes
 * `IMcpServer.declaredIn`) and, optionally, which dialect it is. When `format`
 * is omitted the shape is auto-detected from the root keys.
 */
export interface IMcpParseSource {
  readonly configPath: string
  readonly format?: McpConfigFormat
}

/** The classifier's answer: which agent reads a config path, and its dialect. */
export interface IMcpConfigClassification {
  readonly agent: AgentId
  readonly format: McpConfigFormat
}

// ─────────────────────────────────────────────────────────────
// Pure classification: a config file path → agent + dialect.
// ─────────────────────────────────────────────────────────────

/** Agent home directories that carry MCP JSON, mirroring `catalog.ts`. */
const AgentHomeForMcp = new Map<string, AgentId>([
  ['.claude', AgentId.ClaudeCode],
  ['.cursor', AgentId.Cursor],
  ['.gemini', AgentId.Gemini],
  ['.opencode', AgentId.OpenCode],
  // VS Code is not an `AgentId`; its MCP file is read by Copilot.
  ['.vscode', AgentId.Copilot],
])

function basenameOf(relativePath: string): string {
  const segments = relativePath.split('/').filter(s => s.length > 0)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

/**
 * Classify a repository-relative or home-relative POSIX path as a known MCP
 * JSON config, or `null` when it is not one. Pure; never throws; never touches
 * a disk. Path separators must already be normalised to `/`. TOML configs
 * (e.g. `.codex/config.toml`) are intentionally not matched here — this core
 * parses JSON only.
 */
export function classifyMcpConfigPath(
  relativePath: string
): IMcpConfigClassification | null {
  const segments = relativePath.split('/').filter(s => s.length > 0)
  const basename = basenameOf(relativePath)

  // Repo-root `.mcp.json` and home-root `.claude.json`: Claude, `mcpServers`.
  if (segments.length === 1) {
    if (basename === '.mcp.json' || basename === '.claude.json') {
      return {
        agent: AgentId.ClaudeCode,
        format: McpConfigFormat.McpServersMap,
      }
    }
    if (basename === 'opencode.json') {
      return { agent: AgentId.OpenCode, format: McpConfigFormat.OpenCodeMcp }
    }
    return null
  }

  // Inside a recognised agent home directory.
  const homeIndex = segments.findIndex(s => AgentHomeForMcp.has(s))
  if (homeIndex === -1) {
    return null
  }
  const agent = AgentHomeForMcp.get(segments[homeIndex])!

  if (agent === AgentId.OpenCode && basename === 'opencode.json') {
    return { agent, format: McpConfigFormat.OpenCodeMcp }
  }
  if (agent === AgentId.Copilot && basename === 'mcp.json') {
    return { agent, format: McpConfigFormat.VsCodeServers }
  }
  // Claude/Cursor/Gemini keep MCP in `mcp.json` or `settings.json`.
  if (basename === 'mcp.json' || basename === 'settings.json') {
    return { agent, format: McpConfigFormat.McpServersMap }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Pure parsing + normalization.
// ─────────────────────────────────────────────────────────────

type JsonRecord = { readonly [key: string]: unknown }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

/** Detect the dialect from the root keys when the caller did not specify one. */
function detectFormat(root: JsonRecord): McpConfigFormat | null {
  if ('mcpServers' in root || 'projects' in root) {
    return McpConfigFormat.McpServersMap
  }
  if ('servers' in root) {
    return McpConfigFormat.VsCodeServers
  }
  if ('mcp' in root) {
    return McpConfigFormat.OpenCodeMcp
  }
  return null
}

/** The root key that holds the server map for a given dialect. */
function rootServerKey(format: McpConfigFormat): string {
  switch (format) {
    case McpConfigFormat.McpServersMap:
      return 'mcpServers'
    case McpConfigFormat.VsCodeServers:
      return 'servers'
    case McpConfigFormat.OpenCodeMcp:
      return 'mcp'
  }
}

/** A named entry awaiting normalization. */
interface INamedEntry {
  readonly name: string
  readonly value: unknown
}

/**
 * Collect `{ name, value }` pairs from a server-map object, in insertion order.
 * A non-object container yields no pairs (reported by the caller).
 */
function entriesFromMap(container: unknown): ReadonlyArray<INamedEntry> {
  if (!isRecord(container)) {
    return []
  }
  return Object.keys(container).map(name => ({
    name,
    value: container[name],
  }))
}

/**
 * Normalize the KEYS of any env-like object on the entry. Reads `env`,
 * `environment` and `envs` — whichever are objects — and returns only their
 * key NAMES. The VALUES are never read. Duplicate names collapse.
 */
function envKeysOf(entry: JsonRecord): ReadonlyArray<string> {
  const names = new Set<string>()
  for (const key of ['env', 'environment', 'envs']) {
    const bag = entry[key]
    if (isRecord(bag)) {
      for (const name of Object.keys(bag)) {
        names.add(name)
      }
    }
  }
  return [...names]
}

/** Coerce an explicit `type`/`transport` string to a known transport. */
function explicitTransport(raw: unknown): IMcpServer['transport'] | null {
  if (typeof raw !== 'string') {
    return null
  }
  switch (raw.toLowerCase()) {
    case 'stdio':
    case 'local':
      return 'stdio'
    case 'http':
    case 'streamable-http':
    case 'streamablehttp':
    case 'remote':
      return 'http'
    case 'sse':
      return 'sse'
    default:
      return null
  }
}

interface INormalizedEntry {
  readonly server: IMcpServer | null
  readonly warning: McpNormalizeWarningKind | null
}

/**
 * Turn one named entry into a normalized `IMcpServer`, or into a warning kind.
 * Never reads an env value or a URL value into the result — `IMcpServer` has no
 * slot for either. A remote server's URL is only inspected to classify its
 * transport; its text never leaves this function.
 */
function normalizeEntry(entry: INamedEntry): INormalizedEntry {
  if (!isRecord(entry.value)) {
    return { server: null, warning: 'invalid-entry' }
  }
  const raw = entry.value

  // `command` may be a string (with a sibling `args`) or an array whose head is
  // the command and whose tail are the args (OpenCode).
  let command: string | null = null
  let args: ReadonlyArray<string> = []
  if (typeof raw.command === 'string') {
    command = raw.command
    args = asStringArray(raw.args)
  } else if (Array.isArray(raw.command)) {
    const parts = asStringArray(raw.command)
    command = parts.length > 0 ? parts[0] : null
    args = [...parts.slice(1), ...asStringArray(raw.args)]
  }

  const hasUrl =
    typeof raw.url === 'string' ||
    typeof raw.serverUrl === 'string' ||
    typeof raw.httpUrl === 'string'

  const declared = explicitTransport(raw.type ?? raw.transport)
  const transport: IMcpServer['transport'] | null =
    declared ?? (command !== null ? 'stdio' : hasUrl ? 'http' : null)

  if (transport === null) {
    return { server: null, warning: 'unknown-transport' }
  }
  if (transport === 'stdio' && command === null) {
    return { server: null, warning: 'missing-command' }
  }
  if (transport !== 'stdio' && !hasUrl) {
    return { server: null, warning: 'missing-url' }
  }

  const server: IMcpServer = {
    name: entry.name,
    transport,
    command: transport === 'stdio' ? command : null,
    args: transport === 'stdio' ? args : [],
    envKeys: envKeysOf(raw),
    declaredIn: '',
  }
  return { server, warning: null }
}

/**
 * Parse the RAW text of a JSON MCP config and return the normalized servers it
 * declares plus any warnings. PURE; never throws; no I/O. Unknown transports,
 * missing commands/URLs, malformed JSON and unrecognised shapes all come back
 * as warnings — a bad file is a value, not an exception. No env value, URL, or
 * header value is ever placed in the result.
 */
export function parseMcpConfig(
  rawJson: string,
  source: IMcpParseSource
): IMcpNormalizeResult {
  const warnings: IMcpNormalizeWarning[] = []
  const configPath = source.configPath

  if (rawJson.trim().length === 0) {
    warnings.push({ kind: 'empty', configPath, declaredName: null })
    return { servers: [], warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    // Never rethrow, and never echo the offending text — only the fact.
    warnings.push({ kind: 'malformed-json', configPath, declaredName: null })
    return { servers: [], warnings }
  }

  if (!isRecord(parsed)) {
    warnings.push({
      kind: 'unrecognized-shape',
      configPath,
      declaredName: null,
    })
    return { servers: [], warnings }
  }

  const format = source.format ?? detectFormat(parsed)
  if (format === null) {
    warnings.push({
      kind: 'unrecognized-shape',
      configPath,
      declaredName: null,
    })
    return { servers: [], warnings }
  }

  // Gather every named entry from the dialect's container.
  const entries: INamedEntry[] = []
  const key = rootServerKey(format)
  if (key in parsed) {
    const container = parsed[key]
    if (container !== undefined && !isRecord(container)) {
      // e.g. `mcpServers: []` — an array where an object was expected.
      warnings.push({
        kind: 'unrecognized-shape',
        configPath,
        declaredName: null,
      })
    } else {
      entries.push(...entriesFromMap(container))
    }
  }

  // Claude's `~/.claude.json` also nests servers under `projects[<path>]`.
  if (format === McpConfigFormat.McpServersMap && isRecord(parsed.projects)) {
    for (const projectKey of Object.keys(parsed.projects)) {
      const project = parsed.projects[projectKey]
      if (isRecord(project) && 'mcpServers' in project) {
        entries.push(...entriesFromMap(project.mcpServers))
      }
    }
  }

  const servers: IMcpServer[] = []
  for (const entry of entries) {
    const normalized = normalizeEntry(entry)
    if (normalized.server !== null) {
      servers.push({ ...normalized.server, declaredIn: configPath })
    } else if (normalized.warning !== null) {
      warnings.push({
        kind: normalized.warning,
        configPath,
        declaredName: entry.name,
      })
    }
  }

  return { servers, warnings }
}
