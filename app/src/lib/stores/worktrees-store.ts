// The I/O boundary for worktree metadata (#55). Reconciliation is pure and
// lives in `../worktrees/reconcile`; this store reads `listWorktrees`, resolves
// each worktree's stable identity, applies the plan in one transaction, and
// serves reads and the managed writes (manual status, checkpoint, lineage). The
// reconcile entry point never throws — a git or filesystem failure yields fewer
// changes, not an exception.

import { WorktreesDatabase } from '../databases/worktrees-database'
import {
  IWorktreeMetadata,
  WorktreeManualStatus,
  CheckpointAuthorKind,
  MaxCheckpointLength,
} from '../../models/worktree-metadata'
import { WorktreeEntry } from '../../models/worktree'
import { listWorktrees, resolveWorktreeIdentity } from '../git/worktree'
import { reconcileWorktrees, IWorktreeInsert } from '../worktrees/reconcile'

/** Strip control characters and cap length — a checkpoint is data, not a channel. */
export function sanitizeCheckpointText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, MaxCheckpointLength)
}

/** The lineage a freshly created worktree is born with. All optional. */
export interface IWorktreeLineage {
  readonly parentWorktreeName?: string | null
  readonly lineageTaskRef?: string | null
  readonly baseRef?: string | null
}

/** The current-checkpoint slot's writable fields; `headSha` is HEAD at write. */
export interface ICheckpointWrite {
  readonly text: string
  readonly authorKind: CheckpointAuthorKind
  readonly authorId: string | null
  readonly headSha: string | null
}

export class WorktreesStore {
  public constructor(private readonly db: WorktreesDatabase) {}

  /** Every row (alive and orphaned) for a repository's worktree family. */
  public getFamily(
    commonGitDir: string
  ): Promise<ReadonlyArray<IWorktreeMetadata>> {
    return this.db.worktrees
      .where('commonGitDir')
      .equals(commonGitDir)
      .toArray()
  }

  /** The live rows (`orphanedAt === null`) for a family. */
  public async getLive(
    commonGitDir: string
  ): Promise<ReadonlyArray<IWorktreeMetadata>> {
    const rows = await this.getFamily(commonGitDir)
    return rows.filter(r => r.orphanedAt === null)
  }

  /**
   * Reconcile a repository's worktree family against the live worktrees on disk.
   * Reads `listWorktrees`, resolves each worktree's identity, and applies the
   * plan. Never throws — on any failure it does nothing and returns.
   */
  public async reconcile(
    repositoryPath: string,
    now: number = Date.now()
  ): Promise<void> {
    try {
      const entries = await listWorktrees(repositoryPath)
      if (entries.length === 0) {
        return
      }

      const namesByPath = new Map<string, string>()
      let commonGitDir: string | undefined

      for (const entry of entries) {
        const identity = await resolveWorktreeIdentity(entry)
        if (identity === null) {
          continue
        }
        namesByPath.set(entry.path, identity.worktreeName)
        // Every entry in a family resolves to the same common dir; the main
        // worktree's is the canonical one.
        if (commonGitDir === undefined || entry.type === 'main') {
          commonGitDir = identity.commonGitDir
        }
      }

      if (commonGitDir === undefined) {
        return
      }

      await this.applyReconciliation(commonGitDir, entries, namesByPath, now)
    } catch (err) {
      log.warn(`Failed to reconcile worktrees for '${repositoryPath}'`, err)
    }
  }

  /**
   * Apply a reconciliation for one family. Separated from disk resolution so it
   * is testable without git. Runs in a single read-write transaction.
   */
  public async applyReconciliation(
    commonGitDir: string,
    entries: ReadonlyArray<WorktreeEntry>,
    namesByPath: ReadonlyMap<string, string>,
    now: number = Date.now()
  ): Promise<void> {
    const rows = await this.getFamily(commonGitDir)
    const plan = reconcileWorktrees(
      rows,
      entries,
      namesByPath,
      commonGitDir,
      now
    )

    await this.db.transaction('rw', this.db.worktrees, async () => {
      for (const insert of plan.toInsert) {
        await this.db.worktrees.add(materialize(insert))
      }
      for (const update of plan.toUpdate) {
        await this.db.worktrees.update(update.id, {
          path: update.path,
          branch: update.branch,
          head: update.head,
          isDetached: update.isDetached,
          lastSeenAt: update.lastSeenAt,
          updatedAt: update.lastSeenAt,
        })
      }
      for (const orphan of plan.toOrphan) {
        await this.db.worktrees.update(orphan.id, {
          orphanedAt: orphan.orphanedAt,
          updatedAt: orphan.orphanedAt,
        })
      }
      for (const revive of plan.toRevive) {
        await this.db.worktrees.update(revive.id, {
          orphanedAt: null,
          path: revive.path,
          branch: revive.branch,
          head: revive.head,
          isDetached: revive.isDetached,
          lastSeenAt: revive.lastSeenAt,
          updatedAt: revive.lastSeenAt,
        })
      }
    })
  }

  /**
   * Insert the row for a just-created worktree, already carrying its lineage —
   * for the `addWorktreeWithIncludes` path, which knows the parent and task the
   * reconciliation never can. Upholds the one-live-row invariant: any existing
   * live row for the key is orphaned first, and the new row takes the next
   * generation, so a path reused for a new task starts clean.
   */
  public async createForNewWorktree(
    commonGitDir: string,
    worktreeName: string,
    mirror: {
      readonly path: string
      readonly branch: string | null
      readonly head: string
      readonly isDetached: boolean
    },
    lineage: IWorktreeLineage = {},
    now: number = Date.now()
  ): Promise<void> {
    await this.db.transaction('rw', this.db.worktrees, async () => {
      const family = await this.db.worktrees
        .where('[commonGitDir+worktreeName]')
        .equals([commonGitDir, worktreeName])
        .toArray()

      let maxGeneration = -1
      for (const row of family) {
        maxGeneration = Math.max(maxGeneration, row.generation)
        if (row.orphanedAt === null && row.id !== undefined) {
          await this.db.worktrees.update(row.id, {
            orphanedAt: now,
            updatedAt: now,
          })
        }
      }

      await this.db.worktrees.add({
        commonGitDir,
        worktreeName,
        generation: maxGeneration + 1,
        path: mirror.path,
        branch: mirror.branch,
        head: mirror.head,
        isDetached: mirror.isDetached,
        parentWorktreeName: lineage.parentWorktreeName ?? null,
        lineageTaskRef: lineage.lineageTaskRef ?? null,
        baseRef: lineage.baseRef ?? null,
        manualStatus: null,
        manualStatusDerivedFrom: null,
        checkpointText: null,
        checkpointAuthorKind: null,
        checkpointAuthorId: null,
        checkpointHeadSha: null,
        checkpointUpdatedAt: null,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        orphanedAt: null,
      })
    })
  }

  /** Set (or clear, with `null`) the manual status of a live worktree. */
  public async setManualStatus(
    commonGitDir: string,
    worktreeName: string,
    manualStatus: WorktreeManualStatus | null,
    derivedFrom: string | null,
    now: number = Date.now()
  ): Promise<void> {
    const row = await this.liveRow(commonGitDir, worktreeName)
    if (row?.id === undefined) {
      return
    }
    await this.db.worktrees.update(row.id, {
      manualStatus,
      manualStatusDerivedFrom: manualStatus === null ? null : derivedFrom,
      updatedAt: now,
    })
  }

  /**
   * Write the current checkpoint of a live worktree. The text is sanitized
   * (control characters stripped, capped) here; #58 owns its rendering.
   */
  public async setCheckpoint(
    commonGitDir: string,
    worktreeName: string,
    checkpoint: ICheckpointWrite,
    now: number = Date.now()
  ): Promise<void> {
    const row = await this.liveRow(commonGitDir, worktreeName)
    if (row?.id === undefined) {
      return
    }
    await this.db.worktrees.update(row.id, {
      checkpointText: sanitizeCheckpointText(checkpoint.text),
      checkpointAuthorKind: checkpoint.authorKind,
      checkpointAuthorId: checkpoint.authorId,
      checkpointHeadSha: checkpoint.headSha,
      checkpointUpdatedAt: now,
      updatedAt: now,
    })
  }

  /** Mark the live row for a path orphaned — the `_deleteWorktree` hook. */
  public async markOrphanByPath(
    commonGitDir: string,
    path: string,
    now: number = Date.now()
  ): Promise<void> {
    const rows = await this.getFamily(commonGitDir)
    const live = rows.find(r => r.orphanedAt === null && r.path === path)
    if (live?.id === undefined) {
      return
    }
    await this.db.worktrees.update(live.id, { orphanedAt: now, updatedAt: now })
  }

  /**
   * Rewrite an entire family's `commonGitDir` — the one explicit repair point
   * for when the whole project folder moved and the absolute common dir changed
   * (`updateRepositoryPath` / `recoverMissingWorktree` already know it moved).
   */
  public async repairCommonGitDir(
    oldCommonGitDir: string,
    newCommonGitDir: string,
    now: number = Date.now()
  ): Promise<void> {
    if (oldCommonGitDir === newCommonGitDir) {
      return
    }
    await this.db.transaction('rw', this.db.worktrees, async () => {
      const rows = await this.db.worktrees
        .where('commonGitDir')
        .equals(oldCommonGitDir)
        .toArray()
      for (const row of rows) {
        if (row.id !== undefined) {
          await this.db.worktrees.update(row.id, {
            commonGitDir: newCommonGitDir,
            updatedAt: now,
          })
        }
      }
    })
  }

  private async liveRow(
    commonGitDir: string,
    worktreeName: string
  ): Promise<IWorktreeMetadata | undefined> {
    const family = await this.db.worktrees
      .where('[commonGitDir+worktreeName]')
      .equals([commonGitDir, worktreeName])
      .toArray()
    return family.find(r => r.orphanedAt === null)
  }
}

/** Turn a reconciliation insert into a full row with managed defaults. */
function materialize(insert: IWorktreeInsert): IWorktreeMetadata {
  return {
    commonGitDir: insert.commonGitDir,
    worktreeName: insert.worktreeName,
    generation: insert.generation,
    path: insert.path,
    branch: insert.branch,
    head: insert.head,
    isDetached: insert.isDetached,
    parentWorktreeName: null,
    lineageTaskRef: null,
    baseRef: null,
    manualStatus: null,
    manualStatusDerivedFrom: null,
    checkpointText: null,
    checkpointAuthorKind: null,
    checkpointAuthorId: null,
    checkpointHeadSha: null,
    checkpointUpdatedAt: null,
    createdAt: insert.now,
    updatedAt: insert.now,
    lastSeenAt: insert.now,
    orphanedAt: null,
  }
}
