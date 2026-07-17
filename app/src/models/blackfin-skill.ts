// The Blackfin Skill (#66): the one Skill that teaches an agent the Blackfin CLI
// exists and how to interrogate it. This module holds only the *shapes* — the
// pure generator (`generate-blackfin-skill.ts`) turns a capabilities document
// (#62) into one of these, and the installer (I/O, a later PR) writes it to the
// user's disk after showing a diff.
//
// The Skill is Blackfin's own content: no user data is ever interpolated into
// it, so the same version + target is byte-for-byte identical for every user.

import { AgentId } from './workspace-inventory'

/**
 * The agents whose Skill/rules format the catalog already recognises and whose
 * convention is stable enough to write in v1. A deliberately explicit subset of
 * `AgentId` — the other agents are declared unsupported by their *absence* from
 * this union, which is a compile error at the call site, not a silent skip.
 */
export type SkillTarget =
  | AgentId.ClaudeCode
  | AgentId.Codex
  | AgentId.Cursor
  | AgentId.Shared

/** The version of the Skill *content*, bumped when the prose or contract changes. */
export const BlackfinSkillVersion = 1

/**
 * The delimiters that fence Blackfin's section inside a shared file (`AGENTS.md`)
 * the user already owns. Only the text *between* them is ever Blackfin's to
 * replace; everything outside is the user's and is never touched.
 */
export interface ISkillDelimiters {
  readonly begin: string
  readonly end: string
}

/**
 * A rendered Skill, ready to be compared against the disk and (after the user
 * confirms) written. Pure data — no path is absolute, no machine fact is baked
 * in. `contentHash` is how the installer later tells "written by us" from
 * "edited by the user".
 */
export interface ISkillArtifact {
  /** Relative to the scope root, e.g. `.claude/skills/blackfin/SKILL.md`. */
  readonly relativePath: string
  readonly body: string
  /** sha256 of `body`, hex. How the installer knows if the user edited it. */
  readonly contentHash: string
  readonly version: number
  readonly target: SkillTarget
  /**
   * Non-null only for `Shared` (`AGENTS.md`): the write is a delimited section
   * appended or replaced in place, never the whole file.
   */
  readonly delimited: ISkillDelimiters | null
}

/**
 * What the installer found on disk, decided purely from a content hash. The
 * `modified-by-user` case is load-bearing: it is the state in which Blackfin
 * must never overwrite, only show a diff and stop.
 */
export type SkillInstallState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'current'; readonly version: number }
  | { readonly kind: 'outdated'; readonly version: number }
  /** Exists, and the hash matches no version of ours. NEVER overwrite. */
  | { readonly kind: 'modified-by-user' }

/** One published version of the Skill and the hash of the body we wrote for it. */
export interface IKnownSkillHash {
  readonly version: number
  readonly hash: string
}
