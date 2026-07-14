import Dexie from 'dexie'
import { BaseDatabase } from './base-database'
import { IWorktreeMetadata } from '../../models/worktree-metadata'

/**
 * Blackfin's own database for worktree metadata (#55).
 *
 * Deliberately a *separate* Dexie database, instantiated as
 * `new WorktreesDatabase('BlackfinWorktrees')`, never a new table inside
 * `repositories-database`. That database is tracked against upstream (bumping
 * its schema version risks a rebase conflict and, worse, a version-number
 * collision if upstream also bumps), and — the structural reason — this
 * metadata must *survive* the `Repository` row mutating underneath it on a
 * worktree switch, so it cannot live in the same database as that row.
 *
 * The unique index enforces one row per `[commonGitDir+worktreeName+generation]`.
 * IndexedDB has no partial unique index, so the "at most one *live* row per
 * `[commonGitDir+worktreeName]`" invariant is upheld by the store, not the
 * schema; a dedicated test guards it.
 */
export class WorktreesDatabase extends BaseDatabase {
  public declare worktrees: Dexie.Table<IWorktreeMetadata, number>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)

    this.conditionalVersion(1, {
      worktrees:
        '++id, &[commonGitDir+worktreeName+generation], ' +
        '[commonGitDir+worktreeName], commonGitDir, path, orphanedAt',
    })
  }
}
