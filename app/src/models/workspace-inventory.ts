/**
 * The inventory of everything a repository accumulates that isn't source code:
 * the context that steers coding agents, the documentation, and the build
 * detritus that quietly eats a disk.
 */

/**
 * A coding agent whose configuration we know how to recognise.
 *
 * `Shared` is not an agent. It's the `AGENTS.md` convention, which Codex,
 * OpenCode, Amp, Antigravity and others all read. Attributing it to any one of
 * them would be wrong.
 */
export enum AgentId {
  Shared = 'shared',
  ClaudeCode = 'claude-code',
  Codex = 'codex',
  Cursor = 'cursor',
  Copilot = 'copilot',
  Gemini = 'gemini',
  OpenCode = 'opencode',
  Antigravity = 'antigravity',
  Kimi = 'kimi',
  Windsurf = 'windsurf',
  Aider = 'aider',
  Cline = 'cline',
  Goose = 'goose',
  Continue = 'continue',
}

/** What a given context file *is*, as opposed to which agent reads it. */
export enum ContextRole {
  /** Standing instructions: CLAUDE.md, AGENTS.md, .cursorrules. */
  Instructions = 'instructions',
  /** A skill: a directory with a SKILL.md declaring a capability. */
  Skill = 'skill',
  /** A slash command definition. */
  Command = 'command',
  /** A subagent definition. */
  Subagent = 'subagent',
  /** A reusable prompt. */
  Prompt = 'prompt',
  /** Machine configuration: settings.json, config.toml, opencode.json. */
  Settings = 'settings',
  /** A lifecycle hook script. */
  Hook = 'hook',
}

/** Reclaimable directories, grouped by what they are rather than what tool made them. */
export enum ArtifactKind {
  /** Installed dependencies: node_modules, vendor/bundle, Pods. */
  Dependencies = 'dependencies',
  /** Compiler and bundler output: dist, build, out, target, .next. */
  BuildOutput = 'build-output',
  /** Tool caches: .turbo, .parcel-cache, __pycache__, .gradle. */
  Cache = 'cache',
  /** Language virtual environments: .venv, venv. */
  VirtualEnv = 'virtualenv',
  /** Test coverage output: coverage, .nyc_output. */
  Coverage = 'coverage',
}

/**
 * Where a piece of agent context lives, and therefore how far it reaches.
 *
 * This distinction is the whole reason to show global context at all. A rule in
 * `~/.claude/CLAUDE.md` applies to every project you touch, and it is invisible
 * from inside any of them — so when an agent does something surprising in one
 * repository, the cause may well be a file that repository has never heard of.
 */
export enum ContextScope {
  /** The user's home directory. Applies to every project on this machine. */
  Global = 'global',
  /** Inside a repository. Applies to that project only. */
  Project = 'project',
}

export interface IHeading {
  readonly level: number
  readonly text: string
}

/**
 * A path a context file points at — a Claude `@import` or a relative markdown
 * link. `exists` is resolved against the filesystem, because a context file
 * referencing a document that was deleted six months ago is the single most
 * useful thing this whole feature can tell you.
 */
export interface IContextReference {
  readonly raw: string
  readonly target: string
  readonly exists: boolean
}

export interface IContextFile {
  readonly agent: AgentId
  readonly role: ContextRole
  readonly scope: ContextScope
  readonly relativePath: string
  readonly byteLength: number
  readonly lineCount: number
  readonly modifiedAt: number
  /**
   * For a skill, command or subagent, the `name` and `description` declared in
   * its frontmatter — that's what makes an inventory of them readable.
   */
  readonly name: string | null
  readonly description: string | null
  readonly headings: ReadonlyArray<IHeading>
  readonly ruleCount: number
  readonly references: ReadonlyArray<IContextReference>
  /** Set when the file was too large to parse. Its size is still reported. */
  readonly skippedReason: string | null
}

export interface IDocFile {
  readonly relativePath: string
  readonly title: string | null
  readonly byteLength: number
  readonly lineCount: number
  readonly modifiedAt: number
}

export interface IArtifactDirectory {
  readonly kind: ArtifactKind
  readonly relativePath: string
  /** Recursive size on disk. Measuring this is the expensive part of a scan. */
  readonly byteLength: number
  readonly fileCount: number
  readonly modifiedAt: number
}

export type InventoryStatus =
  /** Scanned. What you see is what is there. */
  | { readonly kind: 'ok' }
  /**
   * Never scanned. We have not looked, so we know nothing — which is different
   * from having looked and found nothing, and must never be rendered as if it
   * were. A project we have not read is not a project without agent context; it
   * is a project we cannot speak about, and it stays out of every count that
   * claims to.
   */
  | { readonly kind: 'never-scanned' }
  /** The repository path is gone from disk. */
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string }

export interface IRepositoryInventory {
  readonly repositoryId: number
  readonly repositoryPath: string
  readonly scannedAt: number
  readonly status: InventoryStatus
  readonly contextFiles: ReadonlyArray<IContextFile>
  readonly docs: ReadonlyArray<IDocFile>
  readonly artifacts: ReadonlyArray<IArtifactDirectory>
}

export function emptyInventory(
  repositoryId: number,
  repositoryPath: string,
  scannedAt: number,
  status: InventoryStatus
): IRepositoryInventory {
  return {
    repositoryId,
    repositoryPath,
    scannedAt,
    status,
    contextFiles: [],
    docs: [],
    artifacts: [],
  }
}

/** Total bytes that could be reclaimed by deleting every artifact directory. */
export function reclaimableBytes(inventory: IRepositoryInventory): number {
  return inventory.artifacts.reduce((sum, a) => sum + a.byteLength, 0)
}

/** References that point at something which no longer exists. */
export function brokenReferences(
  inventory: IRepositoryInventory
): ReadonlyArray<{ file: IContextFile; reference: IContextReference }> {
  const broken = []
  for (const file of inventory.contextFiles) {
    for (const reference of file.references) {
      if (!reference.exists) {
        broken.push({ file, reference })
      }
    }
  }
  return broken
}

/** The distinct agents this repository is configured for. */
export function configuredAgents(
  inventory: IRepositoryInventory
): ReadonlyArray<AgentId> {
  return [...new Set(inventory.contextFiles.map(f => f.agent))]
}

export function contextFilesWithRole(
  inventory: IRepositoryInventory,
  role: ContextRole
): ReadonlyArray<IContextFile> {
  return inventory.contextFiles.filter(f => f.role === role)
}

/**
 * The agent context in the user's home directory, which applies to every
 * project on this machine.
 */
export interface IGlobalContext {
  readonly homePath: string
  readonly scannedAt: number
  readonly status: InventoryStatus
  readonly contextFiles: ReadonlyArray<IContextFile>
}

export function emptyGlobalContext(
  homePath: string,
  scannedAt: number,
  status: InventoryStatus
): IGlobalContext {
  return { homePath, scannedAt, status, contextFiles: [] }
}
