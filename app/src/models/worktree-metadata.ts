// The Blackfin-managed metadata for a worktree (#55).
//
// Git stores nothing about a worktree beyond its path, HEAD and branch. This is
// where Blackfin keeps the rest — lineage, a manual status, and the slot for the
// agent's current checkpoint — and it is deliberately *not* hung off the
// `Repository` row, because switching worktree mutates that row in place
// (`RepositoriesStore.switchWorktree`), so any metadata on it would follow the
// switch and describe the wrong worktree.
//
// Nothing here is ever a secret. The table records paths and names, never file
// contents, never an environment variable, never a token — even though
// `.worktreeinclude` exists precisely to copy `.env` into new worktrees, none of
// that copied content may land in any field of this row.

/** A manual status. `null` means "let the board derive it" (see #59). */
export type WorktreeManualStatus =
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'archived'

/** Who wrote a checkpoint. An agent (via the CLI, #64) or a person. */
export type CheckpointAuthorKind = 'agent' | 'human'

/** The sentinel `worktreeName` for a repository's main worktree. */
export const MainWorktreeName = '(main)'

/** The most a checkpoint may store. #58 owns rendering; this owns the cap. */
export const MaxCheckpointLength = 280

export interface IWorktreeMetadata {
  readonly id?: number

  // --- identity (immutable; never keyed on anything mutable) ---

  /** The common git dir, normalized. From `resolveCommonGitDir()`. Shared by a
   * repository's whole worktree family. */
  readonly commonGitDir: string
  /** The admin name under `<common>/worktrees/`; `'(main)'` for the main one. */
  readonly worktreeName: string
  /** Bumped when the same key is reused by a *new* worktree, so a worktree
   * recreated at a path an old one had does not inherit its checkpoint. */
  readonly generation: number

  // --- git mirror (mutable; reconciliation is the only writer) ---

  readonly path: string
  readonly branch: string | null
  readonly head: string
  readonly isDetached: boolean

  // --- lineage (organizational) ---

  /** The parent's `worktreeName`, in the same `commonGitDir`. Never a path. */
  readonly parentWorktreeName: string | null
  /** What this worktree was created for. Free text or `owner/repo#123`. */
  readonly lineageTaskRef: string | null

  // --- git base (technical, distinct from lineage) ---

  /** The ref the branch was cut from. Not the lineage. */
  readonly baseRef: string | null

  // --- state ---

  readonly manualStatus: WorktreeManualStatus | null
  /** The derived status at the instant of the manual override; see #59. */
  readonly manualStatusDerivedFrom: string | null

  // --- current checkpoint (semantics in #58; this only reserves the slot) ---

  readonly checkpointText: string | null
  readonly checkpointAuthorKind: CheckpointAuthorKind | null
  /** e.g. `'claude-code'`. Identification only — never a token. */
  readonly checkpointAuthorId: string | null
  /** HEAD at the moment of writing — what lets us later say "stale". */
  readonly checkpointHeadSha: string | null
  readonly checkpointUpdatedAt: number | null

  // --- lifecycle ---

  readonly createdAt: number
  readonly updatedAt: number
  readonly lastSeenAt: number
  /** `null` while alive; set once the worktree left `listWorktrees`. We never
   * delete a row — an orphan stays for audit and possible revival. */
  readonly orphanedAt: number | null
}
