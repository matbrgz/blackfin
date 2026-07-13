// Pure worktree reconciliation (#55). No I/O, never throws — a failure upstream
// is a smaller input, not an exception. Given the stored rows for one
// repository's worktree family and the live `listWorktrees` entries, it decides
// which rows to insert, update, orphan or revive. It never deletes, and it never
// touches a checkpoint, a manual status or lineage — those are the user's and
// the agent's, not the git mirror's.

import { WorktreeEntry } from '../../models/worktree'
import { IWorktreeMetadata } from '../../models/worktree-metadata'

/**
 * How recently a row must have been orphaned — and with a matching HEAD — to be
 * revived rather than superseded. This is the line between a transient
 * `listWorktrees` blip (revive the same row) and a real remove-then-recreate at
 * the same path (a new generation, so no checkpoint is inherited).
 */
export const ReviveThresholdMs = 60_000

/** A brand-new row to insert; the store fills the managed defaults. */
export interface IWorktreeInsert {
  readonly commonGitDir: string
  readonly worktreeName: string
  readonly generation: number
  readonly path: string
  readonly branch: string | null
  readonly head: string
  readonly isDetached: boolean
  readonly now: number
}

/** A refresh of a live row's git mirror. Identity and managed state untouched. */
export interface IWorktreeUpdate {
  readonly id: number
  readonly path: string
  readonly branch: string | null
  readonly head: string
  readonly isDetached: boolean
  readonly lastSeenAt: number
}

/** Marking a live row orphaned — it left `listWorktrees`. Never a delete. */
export interface IWorktreeOrphan {
  readonly id: number
  readonly orphanedAt: number
}

/** Un-orphaning a recently orphaned row whose HEAD still matches. */
export interface IWorktreeRevive {
  readonly id: number
  readonly path: string
  readonly branch: string | null
  readonly head: string
  readonly isDetached: boolean
  readonly lastSeenAt: number
}

export interface IWorktreeReconciliation {
  readonly toInsert: ReadonlyArray<IWorktreeInsert>
  readonly toUpdate: ReadonlyArray<IWorktreeUpdate>
  readonly toOrphan: ReadonlyArray<IWorktreeOrphan>
  readonly toRevive: ReadonlyArray<IWorktreeRevive>
}

/**
 * Reconcile the stored rows for one worktree family against the live entries.
 *
 * `rows` are every row (alive and orphaned) for `commonGitDir`. `entries` are
 * the live worktrees from `listWorktrees`. `namesByPath` maps a live worktree's
 * path to its administrative name (`'(main)'` for the main worktree); an entry
 * whose name cannot be resolved is skipped rather than mis-keyed.
 */
export function reconcileWorktrees(
  rows: ReadonlyArray<IWorktreeMetadata>,
  entries: ReadonlyArray<WorktreeEntry>,
  namesByPath: ReadonlyMap<string, string>,
  commonGitDir: string,
  now: number
): IWorktreeReconciliation {
  // Index the rows by administrative name. By the store's invariant there is at
  // most one live (non-orphaned) row per name; we still fold defensively.
  const liveByName = new Map<string, IWorktreeMetadata>()
  const maxGenByName = new Map<string, number>()
  const orphansByName = new Map<string, Array<IWorktreeMetadata>>()

  for (const row of rows) {
    const gen = maxGenByName.get(row.worktreeName)
    if (gen === undefined || row.generation > gen) {
      maxGenByName.set(row.worktreeName, row.generation)
    }

    if (row.orphanedAt === null) {
      // Keep the highest-generation live row if the invariant was ever broken.
      const existing = liveByName.get(row.worktreeName)
      if (existing === undefined || row.generation > existing.generation) {
        liveByName.set(row.worktreeName, row)
      }
    } else {
      const list = orphansByName.get(row.worktreeName) ?? []
      list.push(row)
      orphansByName.set(row.worktreeName, list)
    }
  }

  const toInsert = new Array<IWorktreeInsert>()
  const toUpdate = new Array<IWorktreeUpdate>()
  const toRevive = new Array<IWorktreeRevive>()

  // Names seen alive this pass — everything else that is live becomes an orphan.
  const seenNames = new Set<string>()

  for (const entry of entries) {
    const worktreeName = namesByPath.get(entry.path)
    if (worktreeName === undefined) {
      continue
    }
    seenNames.add(worktreeName)

    const live = liveByName.get(worktreeName)
    if (live !== undefined) {
      // A live row already represents this worktree: refresh its git mirror.
      // We always bump lastSeenAt so orphaning can trust it; the store may
      // skip a no-op write, but the intent is an update.
      if (live.id !== undefined) {
        toUpdate.push({
          id: live.id,
          path: entry.path,
          branch: entry.branch,
          head: entry.head,
          isDetached: entry.isDetached,
          lastSeenAt: now,
        })
      }
      continue
    }

    // No live row. A recently orphaned row with the same HEAD is a transient
    // blip we revive; anything else is a genuine (re)creation and gets a fresh
    // generation, so an unrelated checkpoint is never inherited.
    const revivable = pickRevivable(orphansByName.get(worktreeName), entry, now)
    if (revivable !== undefined && revivable.id !== undefined) {
      toRevive.push({
        id: revivable.id,
        path: entry.path,
        branch: entry.branch,
        head: entry.head,
        isDetached: entry.isDetached,
        lastSeenAt: now,
      })
      continue
    }

    const maxGen = maxGenByName.get(worktreeName)
    toInsert.push({
      commonGitDir,
      worktreeName,
      generation: maxGen === undefined ? 0 : maxGen + 1,
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      isDetached: entry.isDetached,
      now,
    })
  }

  // Any live row whose name was not seen this pass has left listWorktrees.
  const toOrphan = new Array<IWorktreeOrphan>()
  for (const [name, live] of liveByName) {
    if (!seenNames.has(name) && live.id !== undefined) {
      toOrphan.push({ id: live.id, orphanedAt: now })
    }
  }

  return { toInsert, toUpdate, toOrphan, toRevive }
}

/**
 * The orphaned row eligible for revival: orphaned within the threshold and with
 * a HEAD still matching the live entry. Among candidates, the most recently
 * orphaned wins. `undefined` when none qualifies.
 */
function pickRevivable(
  orphans: ReadonlyArray<IWorktreeMetadata> | undefined,
  entry: WorktreeEntry,
  now: number
): IWorktreeMetadata | undefined {
  if (orphans === undefined) {
    return undefined
  }

  let best: IWorktreeMetadata | undefined
  for (const row of orphans) {
    if (row.orphanedAt === null || row.head !== entry.head) {
      continue
    }
    if (now - row.orphanedAt > ReviveThresholdMs) {
      continue
    }
    if (best === undefined || (best.orphanedAt ?? 0) < row.orphanedAt) {
      best = row
    }
  }
  return best
}
