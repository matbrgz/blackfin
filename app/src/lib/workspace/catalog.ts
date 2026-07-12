import {
  AgentId,
  ArtifactKind,
  ContextRole,
} from '../../models/workspace-inventory'

/**
 * Classification of the files a repository accumulates. Everything here is a
 * pure function of a repository-relative POSIX path, so it can be tested
 * without touching a disk.
 */

export interface IContextClassification {
  readonly agent: AgentId
  readonly role: ContextRole
}

/**
 * Directories we never walk into. `node_modules` and friends are absent
 * deliberately: they are classified as artifacts and measured, not skipped.
 */
const NeverWalk = new Set(['.git'])

/**
 * How deep to walk looking for context and documentation. A monorepo's
 * `packages/api/CLAUDE.md` sits at depth 3, and past about six the returns
 * vanish while the cost does not.
 */
export const MaxWalkDepth = 6

interface IArtifactRule {
  readonly kind: ArtifactKind
  /** Directory basename. */
  readonly name: string
  /**
   * When set, the directory only counts as an artifact if this file exists
   * beside it — otherwise `build/` in a repository that keeps hand-written
   * sources in `build/` would be offered up for deletion.
   */
  readonly requiresSibling?: string
}

const ArtifactRules: ReadonlyArray<IArtifactRule> = [
  { kind: ArtifactKind.Dependencies, name: 'node_modules' },
  { kind: ArtifactKind.Dependencies, name: 'bower_components' },
  { kind: ArtifactKind.Dependencies, name: 'Pods' },

  // These names are common enough as ordinary source directories that we only
  // treat them as build output when there's a manifest beside them saying a
  // build tool owns this directory. Deleting someone's hand-written `dist/`
  // because we assumed is not a recoverable mistake.
  {
    kind: ArtifactKind.BuildOutput,
    name: 'dist',
    requiresSibling: 'package.json',
  },
  {
    kind: ArtifactKind.BuildOutput,
    name: 'build',
    requiresSibling: 'package.json',
  },
  {
    kind: ArtifactKind.BuildOutput,
    name: 'out',
    requiresSibling: 'package.json',
  },
  {
    kind: ArtifactKind.BuildOutput,
    name: 'target',
    requiresSibling: 'Cargo.toml',
  },
  { kind: ArtifactKind.BuildOutput, name: '.next' },
  { kind: ArtifactKind.BuildOutput, name: '.nuxt' },
  { kind: ArtifactKind.BuildOutput, name: '.svelte-kit' },
  { kind: ArtifactKind.BuildOutput, name: '.output' },

  { kind: ArtifactKind.Cache, name: '.turbo' },
  { kind: ArtifactKind.Cache, name: '.parcel-cache' },
  { kind: ArtifactKind.Cache, name: '.cache' },
  { kind: ArtifactKind.Cache, name: '.gradle' },
  { kind: ArtifactKind.Cache, name: '__pycache__' },
  { kind: ArtifactKind.Cache, name: '.pytest_cache' },
  { kind: ArtifactKind.Cache, name: '.mypy_cache' },
  { kind: ArtifactKind.Cache, name: '.ruff_cache' },
  { kind: ArtifactKind.Cache, name: '.eslintcache' },

  { kind: ArtifactKind.VirtualEnv, name: '.venv' },
  { kind: ArtifactKind.VirtualEnv, name: 'venv' },

  { kind: ArtifactKind.Coverage, name: 'coverage' },
  { kind: ArtifactKind.Coverage, name: '.nyc_output' },
]

const ArtifactRulesByName = new Map(ArtifactRules.map(r => [r.name, r]))

export function isNeverWalked(basename: string): boolean {
  return NeverWalk.has(basename)
}

/**
 * Classify a directory as reclaimable build detritus.
 *
 * `siblingExists` answers whether a given filename sits in the same parent
 * directory. It's a callback rather than a list because the caller has the
 * directory entries already and we don't want to re-read them.
 */
export function classifyArtifact(
  basename: string,
  siblingExists: (name: string) => boolean
): ArtifactKind | null {
  const rule = ArtifactRulesByName.get(basename)
  if (rule === undefined) {
    return null
  }
  if (
    rule.requiresSibling !== undefined &&
    !siblingExists(rule.requiresSibling)
  ) {
    return null
  }
  return rule.kind
}

/** Standing-instruction files, keyed by exact basename. */
const InstructionFiles = new Map<string, AgentId>([
  ['CLAUDE.md', AgentId.ClaudeCode],
  ['CLAUDE.local.md', AgentId.ClaudeCode],
  // The agents.md convention. Read by Codex, OpenCode, Amp, Antigravity and
  // others, so it belongs to none of them.
  ['AGENTS.md', AgentId.Shared],
  ['AGENT.md', AgentId.Shared],
  ['GEMINI.md', AgentId.Gemini],
  ['KIMI.md', AgentId.Kimi],
  ['.cursorrules', AgentId.Cursor],
  ['.windsurfrules', AgentId.Windsurf],
  ['.clinerules', AgentId.Cline],
  ['.goosehints', AgentId.Goose],
  ['CONVENTIONS.md', AgentId.Aider],
])

/** Agent home directories, and the agent each belongs to. */
const AgentDirectories = new Map<string, AgentId>([
  ['.claude', AgentId.ClaudeCode],
  ['.codex', AgentId.Codex],
  ['.cursor', AgentId.Cursor],
  ['.gemini', AgentId.Gemini],
  ['.opencode', AgentId.OpenCode],
  ['.antigravity', AgentId.Antigravity],
  ['.kimi', AgentId.Kimi],
  ['.windsurf', AgentId.Windsurf],
  ['.continue', AgentId.Continue],
  // Not a dotfile, but the convention `npx skills add` installs into.
  ['.agents', AgentId.Shared],
])

/** Subdirectory name within an agent home directory, and what it holds. */
const AgentSubdirectoryRoles = new Map<string, ContextRole>([
  ['skills', ContextRole.Skill],
  ['commands', ContextRole.Command],
  ['command', ContextRole.Command],
  ['agents', ContextRole.Subagent],
  ['agent', ContextRole.Subagent],
  ['prompts', ContextRole.Prompt],
  ['rules', ContextRole.Instructions],
  ['hooks', ContextRole.Hook],
])

const SettingsFiles = new Set([
  'settings.json',
  'settings.local.json',
  'config.toml',
  'config.json',
  'mcp.json',
])

function isMarkdown(basename: string): boolean {
  return basename.endsWith('.md') || basename.endsWith('.mdc')
}

/**
 * Classify a repository-relative path as agent context.
 *
 * Returns null for anything that isn't. Path separators must already be
 * normalised to `/`.
 */
export function classifyContext(
  relativePath: string
): IContextClassification | null {
  const segments = relativePath.split('/')
  const basename = segments[segments.length - 1]

  // A skill is a directory containing a SKILL.md. We key off the manifest
  // rather than the directory so that a skill is only a skill once it actually
  // declares itself.
  if (basename === 'SKILL.md') {
    return { agent: agentForPath(segments), role: ContextRole.Skill }
  }

  // Copilot keeps everything under .github rather than a home directory of its
  // own, so it doesn't fit the agent-directory shape below.
  if (segments[0] === '.github') {
    if (basename === 'copilot-instructions.md') {
      return { agent: AgentId.Copilot, role: ContextRole.Instructions }
    }
    if (
      segments[1] === 'instructions' &&
      basename.endsWith('.instructions.md')
    ) {
      return { agent: AgentId.Copilot, role: ContextRole.Instructions }
    }
    if (segments[1] === 'prompts' && basename.endsWith('.prompt.md')) {
      return { agent: AgentId.Copilot, role: ContextRole.Prompt }
    }
    return null
  }

  // Root-level `skills/<name>/SKILL.md` is handled above; a bare top-level
  // instruction file is matched by name at any depth, so that a monorepo's
  // packages/api/CLAUDE.md counts.
  const instructionAgent = InstructionFiles.get(basename)
  if (instructionAgent !== undefined) {
    return { agent: instructionAgent, role: ContextRole.Instructions }
  }

  // Anything inside a recognised agent home directory.
  const homeIndex = segments.findIndex(s => AgentDirectories.has(s))
  if (homeIndex === -1) {
    return null
  }

  const agent = AgentDirectories.get(segments[homeIndex])!
  const rest = segments.slice(homeIndex + 1)

  if (rest.length === 0) {
    return null
  }

  if (rest.length === 1) {
    if (SettingsFiles.has(basename)) {
      return { agent, role: ContextRole.Settings }
    }
    // e.g. .opencode/opencode.json, .codex/config.toml handled above; a bare
    // markdown file directly in the home directory reads as instructions.
    return isMarkdown(basename)
      ? { agent, role: ContextRole.Instructions }
      : null
  }

  const role = AgentSubdirectoryRoles.get(rest[0])
  if (role === undefined) {
    return SettingsFiles.has(basename)
      ? { agent, role: ContextRole.Settings }
      : null
  }

  if (role === ContextRole.Hook) {
    return { agent, role }
  }

  return isMarkdown(basename) ? { agent, role } : null
}

/**
 * Which agent owns a path, judged by the nearest recognised home directory.
 * Falls back to `Shared` — a bare `skills/foo/SKILL.md` at the repository root
 * is the convention Orca and `npx skills add` use, and it belongs to whichever
 * agent installs it.
 */
function agentForPath(segments: ReadonlyArray<string>): AgentId {
  for (const segment of segments) {
    const agent = AgentDirectories.get(segment)
    if (agent !== undefined) {
      return agent
    }
  }
  return AgentId.Shared
}

const DocDirectories = new Set(['docs', 'doc', 'documentation'])

/**
 * Documentation, as distinct from agent context. A README is documentation; a
 * CLAUDE.md is not, even though both are markdown at the repository root.
 *
 * Call `classifyContext` first — this deliberately does not exclude context
 * files, because the caller has already claimed them.
 */
export function isDoc(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const basename = segments[segments.length - 1]

  if (!basename.endsWith('.md') && !basename.endsWith('.mdx')) {
    return false
  }

  if (segments.length === 1) {
    return true
  }

  return segments.slice(0, -1).some(s => DocDirectories.has(s))
}

/** Human-readable label for an agent, for the UI. */
export function agentDisplayName(agent: AgentId): string {
  switch (agent) {
    case AgentId.Shared:
      return 'AGENTS.md'
    case AgentId.ClaudeCode:
      return 'Claude Code'
    case AgentId.Codex:
      return 'Codex'
    case AgentId.Cursor:
      return 'Cursor'
    case AgentId.Copilot:
      return 'Copilot'
    case AgentId.Gemini:
      return 'Gemini'
    case AgentId.OpenCode:
      return 'OpenCode'
    case AgentId.Antigravity:
      return 'Antigravity'
    case AgentId.Kimi:
      return 'Kimi'
    case AgentId.Windsurf:
      return 'Windsurf'
    case AgentId.Aider:
      return 'Aider'
    case AgentId.Cline:
      return 'Cline'
    case AgentId.Goose:
      return 'Goose'
    case AgentId.Continue:
      return 'Continue'
  }
}

export function artifactDisplayName(kind: ArtifactKind): string {
  switch (kind) {
    case ArtifactKind.Dependencies:
      return 'Dependencies'
    case ArtifactKind.BuildOutput:
      return 'Build output'
    case ArtifactKind.Cache:
      return 'Cache'
    case ArtifactKind.VirtualEnv:
      return 'Virtual environment'
    case ArtifactKind.Coverage:
      return 'Coverage'
  }
}
