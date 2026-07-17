// The pure heart of #66. Turn a capabilities document (#62) into a rendered
// Blackfin Skill for one target agent. No I/O, no clock, no user data: the same
// document and target produce the same bytes for everyone, which is what the
// determinism and no-leak tests assert and what makes the Skill safe to ship
// into every agent's context on the machine.
//
// The one design decision this file enforces mechanically: the Skill body lists
// **no command except `capabilities`**. The volatile parts — exit codes,
// guardrails, the envelope — are read out of the document, never hand-written,
// so they cannot rot next to a CLI that grew a command. Everything else is a
// versioned prose template. The test walks the registry and fails if any other
// command name appears in the body.

import { createHash } from 'crypto'
import { AgentId } from '../../models/workspace-inventory'
import {
  BlackfinSkillVersion,
  IKnownSkillHash,
  ISkillArtifact,
  SkillInstallState,
  SkillTarget,
} from '../../models/blackfin-skill'
import { ICapabilitiesDocument } from '../cli/capabilities'

/** The `name` frontmatter key, and the id the inventory catalogs the Skill under. */
export const BlackfinSkillName = 'blackfin'

/**
 * The `description` frontmatter — the one line the agent sees in a listing
 * before it ever opens the file. It is Blackfin's own prose: no path, no branch,
 * no project name, and no colon (so it stays a valid unquoted YAML scalar).
 */
export const BlackfinSkillDescription =
  'Ask Blackfin — the agentic control center running on this machine — what ' +
  'context governs your working directory, what skills and MCP servers are ' +
  'active, and what this worktree is for. Write a checkpoint so the human can ' +
  'see where the work stands without opening your terminal.'

/**
 * The prose template, byte-identical to `app/static/skills/blackfin/SKILL.md`
 * template checked into the repo — a test asserts the two never drift. The
 * `{{…}}` slots are the only things filled from the document, and none of them
 * can contain a command name or a machine fact.
 */
export const BlackfinSkillTemplate = `# Blackfin

Blackfin is a desktop app the user has open right now. It has an inventory of the
agent context on this machine — including **global** context in the user's home
directory, which applies to every project and **is not visible from inside any of
them.** You cannot see that from where you are. Blackfin can.

Blackfin does not run you. It does not know you exist until you call it.

## Start here

Run this **first**, once, and read the output:

    blackfin capabilities --json

It prints every command, its arguments, whether it changes anything, and what it
is allowed to do without asking the user. **That output is the source of truth —
this file is not.** Do not guess a command. Do not assume a command from this
document still exists.

## How to read a result

Every command takes \`--json\` and prints one JSON object:

    {{ENVELOPE_SUCCESS}}
    {{ENVELOPE_FAILURE}}

Exit codes that matter:

{{EXIT_CODES}}

## Rules

{{GUARDRAILS}}
`

/** The delimiters Blackfin fences its section with inside a shared `AGENTS.md`. */
const SharedBegin = `<!-- blackfin:begin v${BlackfinSkillVersion} — managed by Blackfin. Edit outside these markers. -->`
const SharedEnd = '<!-- blackfin:end -->'

/** Where each target's file lives, relative to the scope root. */
function relativePathFor(target: SkillTarget): string {
  switch (target) {
    case AgentId.ClaudeCode:
      return '.claude/skills/blackfin/SKILL.md'
    case AgentId.Codex:
      return '.codex/skills/blackfin/SKILL.md'
    case AgentId.Cursor:
      return '.cursor/rules/blackfin.mdc'
    case AgentId.Shared:
      return 'AGENTS.md'
    default:
      return assertNever(target)
  }
}

/** Render the template's core, filling only the document-derived slots. */
function renderCore(doc: ICapabilitiesDocument): string {
  const exitCodes = doc.exitCodes
    .map(e => `- \`${e.code}\` — ${e.meaning}`)
    .join('\n')
  const guardrails = doc.guardrails.map(g => `- ${g}`).join('\n')

  return BlackfinSkillTemplate.replace(
    '{{ENVELOPE_SUCCESS}}',
    doc.envelope.success
  )
    .replace('{{ENVELOPE_FAILURE}}', doc.envelope.failure)
    .replace('{{EXIT_CODES}}', exitCodes)
    .replace('{{GUARDRAILS}}', guardrails)
}

/** The `name: … / description: …` frontmatter a Skill file (Claude Code, Codex) carries. */
function skillFrontmatter(): string {
  return (
    `---\n` +
    `name: ${BlackfinSkillName}\n` +
    `description: ${BlackfinSkillDescription}\n` +
    `---\n\n`
  )
}

/** The `.mdc` frontmatter a Cursor rule carries — description, always applied. */
function cursorFrontmatter(): string {
  return (
    `---\n` +
    `description: ${BlackfinSkillDescription}\n` +
    `alwaysApply: true\n` +
    `---\n\n`
  )
}

/** Wrap the core for one target: frontmatter, `.mdc`, or a delimited section. */
function bodyFor(target: SkillTarget, core: string): string {
  switch (target) {
    case AgentId.ClaudeCode:
    case AgentId.Codex:
      return skillFrontmatter() + core
    case AgentId.Cursor:
      return cursorFrontmatter() + core
    case AgentId.Shared:
      return `${SharedBegin}\n${core}${SharedEnd}\n`
    default:
      return assertNever(target)
  }
}

/**
 * Render the Blackfin Skill for one target. Pure and deterministic: the only
 * inputs are the document and the target, and neither carries a user path, a
 * token, or a repository name.
 */
export function generateBlackfinSkill(
  doc: ICapabilitiesDocument,
  target: SkillTarget
): ISkillArtifact {
  const core = renderCore(doc)
  const body = bodyFor(target, core)
  const contentHash = createHash('sha256').update(body, 'utf8').digest('hex')
  return {
    relativePath: relativePathFor(target),
    body,
    contentHash,
    version: BlackfinSkillVersion,
    target,
    delimited:
      target === AgentId.Shared ? { begin: SharedBegin, end: SharedEnd } : null,
  }
}

/**
 * Classify what is on disk from its content hash alone. Pure — the caller does
 * the read and passes the hash (or `null` if absent). A hash matching no known
 * version is `modified-by-user`, the state in which the installer must never
 * overwrite. `current` is the highest known version; anything older is
 * `outdated` and can be offered as an update (with a diff).
 */
export function classifyInstallState(
  onDiskHash: string | null,
  knownHashes: ReadonlyArray<IKnownSkillHash>
): SkillInstallState {
  if (onDiskHash === null) {
    return { kind: 'absent' }
  }
  const match = knownHashes.find(h => h.hash === onDiskHash)
  if (match === undefined) {
    return { kind: 'modified-by-user' }
  }
  const latest = knownHashes.reduce(
    (max, h) => (h.version > max ? h.version : max),
    match.version
  )
  return match.version === latest
    ? { kind: 'current', version: match.version }
    : { kind: 'outdated', version: match.version }
}

/** Exhaustiveness guard: a new `SkillTarget` without a case fails to compile. */
function assertNever(value: never): never {
  throw new Error(`Unhandled skill target: ${String(value)}`)
}
