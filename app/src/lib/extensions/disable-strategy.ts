/**
 * The disable/enable DECISION core (issue #40) — PURE.
 *
 * Most coding agents have no concept of "disabled": a file in
 * `~/.claude/skills/` is loaded because it is THERE (`catalog.ts`'s scanned
 * subdirectories are the operational definition of "the agent sees this"). So
 * "disable" is not a flag Blackfin can flip — it is a real change to what the
 * agent loads, and choosing HOW to make that change is the only real decision in
 * this issue. That decision is a pure function so it is testable without touching
 * disk, and so the honesty rule below can be enforced by tests, not by hope:
 *
 *   RATIFIED (RFC #11 D4): disabling is an explicit, reversible edit of the
 *   user's config; `disabled` is a disk fact read back, never a stored lie.
 *
 * "A control that does not control is worse than none." (#40) This module NEVER
 * returns a strategy that merely RECORDS intent while the agent keeps loading the
 * item. When there is no honest way to stop the load, it returns `unsupported`
 * with a machine-readable reason — the explicit "can't", never a fake toggle.
 *
 * This module DECIDES; it never MUTATES. It returns a DESCRIPTION of the edit /
 * move / refusal as data. No fs write, no move, no config rewrite happens here —
 * the executor (runtime follow-up) performs it, routing config edits through the
 * diff-before-save flow (#28). Everything here is pure: no I/O, deterministic,
 * and it never throws — malformed input yields a well-formed `unsupported`.
 */

import { AgentId } from '../../models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  IDetectedCapability,
} from '../../models/extension'

/** Which way the edit runs. Enabling is the exact inverse of disabling. */
export type DisableAction = 'disable' | 'enable'

/**
 * The list operation on a native disable key: disabling ADDS the entry's name to
 * the config's disabled-list; enabling REMOVES it. The inverse is total.
 */
export type ConfigEditOperation =
  | 'add-to-disabled-list'
  | 'remove-from-disabled-list'

/**
 * The machine-readable reasons a disable cannot be done honestly. Each is a
 * refusal the UI must render as "can't", never as a "Disabled" badge.
 */
export type UnsupportedReason =
  /**
   * The item is GLOBAL and the target is a single project, and the agent
   * documents no per-project override. One file, living outside the project, has
   * no move that means "off here, on elsewhere". The honest answer is "can't".
   */
  | 'global-item-project-scope-no-override'
  /**
   * The item is an entry inside a shared config file the user owns (e.g. a
   * server in `.mcp.json`) and the agent documents no key to switch it off
   * without removing it. Blackfin will not rewrite the user's file on its own,
   * and will not lift the entry's contents (they may hold env values) — so it
   * refuses and routes to #28.
   */
  | 'agent-has-no-disable-mechanism'
  /** The item is not in a location whose removal from the scan would disable it. */
  | 'item-not-in-a-scanned-location'
  /** The input was empty or malformed. A pure function must still answer. */
  | 'malformed-item'

/**
 * `config-edit` — the agent has a DOCUMENTED key that turns the item off in the
 * user's config. Blackfin describes the minimal edit; #28 shows the diff and
 * writes it. The entry is referenced BY NAME only — this strategy never reads,
 * carries, or stores a value (an MCP entry may hold env-var VALUES; those never
 * enter Blackfin). Reversible: `operation` flips with `action`.
 */
export interface IConfigEditStrategy {
  readonly kind: 'config-edit'
  readonly action: DisableAction
  readonly agent: AgentId
  /** The user config file to edit, relative. Blackfin describes; #28 writes. */
  readonly configPath: string
  /** The documented key that holds the disabled-list. Never invented. */
  readonly configKey: string
  /** ADD on disable, REMOVE on enable — the inverse is total. */
  readonly operation: ConfigEditOperation
  /** The entry, BY NAME. Never a value, never an env value. */
  readonly entryName: string
  /**
   * The documentation citation that authorises `configKey`. No citation ⇒ this
   * branch is never taken (inventing a key corrupts the user's file). Carried as
   * data so the honesty is visible at the call site and in tests.
   */
  readonly docCitation: string
}

/**
 * `move` — the item is its own file or directory, loaded only because it sits
 * inside a directory the agent scans. Taking it OUT of that directory is the
 * operational definition of disabling it, and it works for every agent that
 * globs the path. Blackfin returns the source root and a proposed target; the
 * executor moves it into quarantine under `userData`, OUTSIDE any repository, so
 * a disabled item can never be committed by accident. Disabling NEVER deletes:
 * the target is a disabled sibling, restorable on enable (source/target swap).
 *
 * `rename`-in-place (`foo.md` → `foo.md.disabled`) is deliberately NOT a
 * strategy: the ignored suffix is per-agent and unverifiable, and a forgotten
 * `.disabled` file inside a repo gets committed. Moving out of the repo is
 * cleaner and more reversible (#40, "Fora de escopo").
 */
export interface IMoveStrategy {
  readonly kind: 'move'
  readonly action: DisableAction
  readonly agent: AgentId
  /** The item's own root, relative: the skill DIRECTORY, or the single FILE. */
  readonly sourceRoot: string
  /**
   * Proposed relative name for the disabled sibling. The executor resolves the
   * real absolute location under `userData`; on enable, source and target swap.
   */
  readonly proposedTarget: string
  /**
   * Non-null when the move happens inside a git working tree (project / worktree
   * scope): moving a tracked file shows as a REMOVAL in the user's diff, and a
   * distracted `git commit -a` would persist it. The caller confirms tracking
   * via git and warns before acting. Null for global items (`~` is not a repo).
   */
  readonly gitConsequence: string | null
}

/**
 * `unsupported` — there is no honest way to make the agent stop loading the item
 * in the requested scope. Blackfin refuses and explains; the UI shows the reason,
 * never a "Disabled" badge. `configPath` names the user's file to open in #28
 * when one is implicated, else null. NOTHING is written.
 */
export interface IUnsupportedStrategy {
  readonly kind: 'unsupported'
  readonly reason: UnsupportedReason
  /** A human-facing explanation of the refusal. */
  readonly detail: string
  /** The user config file to open in #28, when implicated; else null. */
  readonly configPath: string | null
}

/** The three honest outcomes. There is deliberately no `record-only`. */
export type DisableStrategy =
  | IConfigEditStrategy
  | IMoveStrategy
  | IUnsupportedStrategy

// ─────────────────────────────────────────────────────────────
// The native-disable support table. A row exists ONLY with a documentation
// citation; an agent without a cited key is `unsupported`, because writing a key
// the agent does not know is corrupting someone's file with garbage (#40).
// ─────────────────────────────────────────────────────────────

interface INativeDisableSupport {
  /** Basename of the config file that holds the key, under the agent's home dir. */
  readonly configFileBasename: string
  /** The documented key holding the list of disabled entry names. */
  readonly configKey: string
  /** One citation per row. No citation ⇒ no row ⇒ `unsupported`. */
  readonly docCitation: string
}

/**
 * The documented disable mechanism for an (agent, kind) pair, or null.
 *
 * Only Claude Code MCP servers qualify today: Claude Code's `settings.json`
 * documents `disabledMcpjsonServers`, a list of `.mcp.json` server NAMES to
 * reject. It references servers by name only — it never carries an env value —
 * which is exactly why it is an honest `config-edit` and not a secret leak.
 */
function nativeDisableSupport(
  agent: AgentId,
  kind: CapabilityKind
): INativeDisableSupport | null {
  if (agent === AgentId.ClaudeCode && kind === CapabilityKind.McpServer) {
    return {
      configFileBasename: 'settings.json',
      configKey: 'disabledMcpjsonServers',
      // Citation (docs.claude.com/en/docs/claude-code/settings):
      //   `disabledMcpjsonServers` — "List of specific MCP servers from
      //   .mcp.json files to reject". Names only; no env value is referenced.
      docCitation:
        'Claude Code settings.json `disabledMcpjsonServers`: "List of specific ' +
        'MCP servers from .mcp.json files to reject" ' +
        '(docs.claude.com/en/docs/claude-code/settings). Referenced by name only.',
    }
  }
  return null
}

/** The agent home directory that holds an agent's config, for path building. */
function agentHomeDir(agent: AgentId): string {
  switch (agent) {
    case AgentId.ClaudeCode:
      return '.claude'
    case AgentId.Codex:
      return '.codex'
    case AgentId.Cursor:
      return '.cursor'
    case AgentId.Gemini:
      return '.gemini'
    case AgentId.OpenCode:
      return '.opencode'
    case AgentId.Antigravity:
      return '.antigravity'
    case AgentId.Kimi:
      return '.kimi'
    case AgentId.Windsurf:
      return '.windsurf'
    case AgentId.Continue:
      return '.continue'
    case AgentId.Shared:
    case AgentId.Copilot:
    case AgentId.Aider:
    case AgentId.Cline:
    case AgentId.Goose:
      return '.agents'
  }
}

// ─────────────────────────────────────────────────────────────
// Pure path helpers. Separators are already normalised to '/' by the scanners.
// ─────────────────────────────────────────────────────────────

function segmentsOf(relativePath: string): ReadonlyArray<string> {
  return relativePath.split('/').filter(segment => segment.length > 0)
}

function basename(relativePath: string): string {
  const segments = segmentsOf(relativePath)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

/**
 * The item's own root: a skill's identity is its DIRECTORY (the folder holding
 * `SKILL.md`), everything else is its single file. This is what `move` relocates.
 */
function itemRoot(item: IDetectedCapability): string {
  const segments = segmentsOf(item.relativePath)
  if (segments.length === 0) {
    return ''
  }
  const last = segments[segments.length - 1]
  if (
    item.kind === CapabilityKind.Skill &&
    last.toLowerCase() === 'skill.md' &&
    segments.length >= 2
  ) {
    return segments.slice(0, -1).join('/')
  }
  return segments.join('/')
}

/** The kinds that are a file or directory removed-from-scan disables. */
function isRelocatableKind(kind: CapabilityKind): boolean {
  switch (kind) {
    case CapabilityKind.Instruction:
    case CapabilityKind.Skill:
    case CapabilityKind.Command:
    case CapabilityKind.Subagent:
    case CapabilityKind.Prompt:
    case CapabilityKind.Hook:
      return true
    case CapabilityKind.McpServer:
      return false
  }
}

function unsupported(
  reason: UnsupportedReason,
  detail: string,
  configPath: string | null
): IUnsupportedStrategy {
  return { kind: 'unsupported', reason, detail, configPath }
}

/**
 * Decide how `item` would be disabled or enabled in `targetScope`, WITHOUT doing
 * it. Pure, deterministic, and it never throws: any malformed input returns a
 * well-formed `unsupported`. `targetRepositoryId` identifies the project when
 * `targetScope` is narrower than Global (null when unknown / Global).
 */
function chooseStrategy(
  item: IDetectedCapability,
  targetScope: CapabilityScope,
  targetRepositoryId: number | null,
  action: DisableAction
): DisableStrategy {
  // Guard: a pure function must answer even on junk. Never throw.
  if (
    item === null ||
    item === undefined ||
    typeof item.relativePath !== 'string' ||
    segmentsOf(item.relativePath).length === 0
  ) {
    return unsupported(
      'malformed-item',
      'The item has no usable path, so no disable location can be derived.',
      null
    )
  }

  const agent = item.agents.length > 0 ? item.agents[0] : AgentId.Shared

  // The one case with no solution: a GLOBAL item disabled for a SINGLE project,
  // when the agent has no per-project override. The file is one, it lives
  // outside the project, and no move expresses "off here, on elsewhere". The
  // correct answer is an explicit "can't" — never a move, never a fake toggle.
  // (`disabledMcpjsonServers` disables a project's OWN .mcp.json servers, not a
  // globally-declared item, so it is not such an override.)
  if (
    item.scope === CapabilityScope.Global &&
    targetScope !== CapabilityScope.Global
  ) {
    const where =
      targetRepositoryId === null
        ? 'this project'
        : `project ${targetRepositoryId}`
    return unsupported(
      'global-item-project-scope-no-override',
      `"${item.logicalName}" is a global item; ${agent} documents no way to ` +
        `ignore it in ${where} only. Disable it globally, or move it into this ` +
        `project's scope and disable it there.`,
      null
    )
  }

  // A config-declared entry (an MCP server inside a shared file). Honest only
  // when the agent documents a key AND that key actually applies here; otherwise
  // Blackfin refuses rather than rewrite the user's file or lift its contents.
  if (item.kind === CapabilityKind.McpServer) {
    const declaringFile = item.mcp !== null ? item.mcp.declaredIn : null
    const support = nativeDisableSupport(agent, item.kind)
    // The key targets a project's own `.mcp.json` servers only.
    const declaredInProjectMcpJson =
      declaringFile !== null && basename(declaringFile) === '.mcp.json'
    const appliesHere =
      support !== null &&
      declaredInProjectMcpJson &&
      item.scope === CapabilityScope.Project &&
      targetScope === CapabilityScope.Project
    if (support !== null && appliesHere) {
      const entryName = item.mcp !== null ? item.mcp.name : item.logicalName
      return {
        kind: 'config-edit',
        action,
        agent,
        configPath: `${agentHomeDir(agent)}/${support.configFileBasename}`,
        configKey: support.configKey,
        operation:
          action === 'disable'
            ? 'add-to-disabled-list'
            : 'remove-from-disabled-list',
        entryName,
        docCitation: support.docCitation,
      }
    }
    return unsupported(
      'agent-has-no-disable-mechanism',
      `"${item.logicalName}" is declared inside a shared config file, and ` +
        `${agent} documents no key to switch it off without removing it. ` +
        `Blackfin will not rewrite that file or store its contents; open it in ` +
        `#28 to edit it yourself.`,
      declaringFile
    )
  }

  // A file or directory loaded because it sits in a scanned path. Removing it
  // from the scan is the honest disable, and it works for every agent that globs
  // the path. Move out to quarantine — never delete, never rename in place.
  if (isRelocatableKind(item.kind)) {
    const root = itemRoot(item)
    const gitConsequence =
      targetScope === CapabilityScope.Project ||
      targetScope === CapabilityScope.Worktree
        ? 'Moving this out of the working tree shows as a removal of the ' +
          "item's files in git; a distracted `git commit -a` would persist it."
        : null
    return {
      kind: 'move',
      action,
      agent,
      sourceRoot: root,
      proposedTarget: basename(root),
      gitConsequence,
    }
  }

  return unsupported(
    'item-not-in-a-scanned-location',
    `"${item.logicalName}" is not in a location whose removal from the agent's ` +
      `scan would disable it, so Blackfin cannot honestly turn it off.`,
    null
  )
}

/**
 * DECIDE how `item` would be disabled in `targetScope` — config-edit, move, or
 * the honest `unsupported`. Returns a description; performs nothing. Pure.
 */
export function chooseDisableStrategy(
  item: IDetectedCapability,
  targetScope: CapabilityScope,
  targetRepositoryId: number | null
): DisableStrategy {
  return chooseStrategy(item, targetScope, targetRepositoryId, 'disable')
}

/**
 * DECIDE how `item` would be re-enabled in `targetScope` — the exact inverse of
 * disabling: `config-edit` flips ADD→REMOVE, `move` swaps source and target on
 * the executor's side (same fields, `action: 'enable'`). `unsupported` stays
 * unsupported. Returns a description; performs nothing. Pure.
 */
export function chooseEnableStrategy(
  item: IDetectedCapability,
  targetScope: CapabilityScope,
  targetRepositoryId: number | null
): DisableStrategy {
  return chooseStrategy(item, targetScope, targetRepositoryId, 'enable')
}
