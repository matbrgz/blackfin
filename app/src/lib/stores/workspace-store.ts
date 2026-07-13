import { homedir } from 'os'
import { BaseStore } from './base-store'
import { WorkspaceDatabase } from '../databases/workspace-database'
import {
  IGlobalContext,
  IRepositoryInventory,
  emptyGlobalContext,
} from '../../models/workspace-inventory'
import { scanRepository } from '../workspace/scan'
import { scanGlobalContext } from '../workspace/scan-global'
import {
  CleanupOutcome,
  deleteArtifact,
  ICleanupOptions,
} from '../workspace/cleanup'

/**
 * How many repositories we scan at once. Scanning is dominated by walking
 * directories, so the limit exists to keep the app responsive rather than to
 * respect any real resource ceiling.
 */
const ScanConcurrency = 4

export interface IScanProgress {
  readonly scanning: boolean
  readonly completed: number
  readonly total: number
}

export interface IScannableRepository {
  readonly id: number
  readonly path: string
}

/**
 * The workspace inventory across every repository the user has.
 *
 * The behaviour that makes the center feel instant: the cache is read from disk
 * and emitted immediately, so the screen paints full rather than showing a
 * spinner. A rescan then runs behind it and emits again as each repository
 * lands.
 */
export class WorkspaceStore extends BaseStore {
  private readonly inventories = new Map<number, IRepositoryInventory>()
  private progress: IScanProgress = {
    scanning: false,
    completed: 0,
    total: 0,
  }

  /** Aborts the scan in flight, if there is one. */
  private abortController: AbortController | null = null

  /**
   * The agent context in the user's home directory. Held in memory only — it is
   * one directory tree, it scans in milliseconds, and caching it would buy
   * nothing but a chance to show something stale.
   */
  private globalContext: IGlobalContext = emptyGlobalContext(homedir(), 0, {
    kind: 'ok',
  })

  public constructor(
    private readonly db: WorkspaceDatabase,
    private readonly now: () => number = () => Date.now()
  ) {
    super()
  }

  public getInventories(): ReadonlyMap<number, IRepositoryInventory> {
    return this.inventories
  }

  public getGlobalContext(): IGlobalContext {
    return this.globalContext
  }

  public async rescanGlobalContext(): Promise<void> {
    this.globalContext = await scanGlobalContext(homedir(), this.now())
    this.emitUpdate()
  }

  public getInventory(repositoryId: number): IRepositoryInventory | null {
    return this.inventories.get(repositoryId) ?? null
  }

  public getProgress(): IScanProgress {
    return this.progress
  }

  /** Read the cache from disk. Cheap, and the screen can paint from it. */
  public async loadFromCache(): Promise<void> {
    const cached = await this.db.getAllInventories()

    for (const inventory of cached) {
      this.inventories.set(inventory.repositoryId, inventory)
    }

    this.emitUpdate()
  }

  /**
   * Rescan every repository. Emits after each one completes, so the screen
   * fills in progressively instead of sitting blank until the slowest
   * repository — invariably the one with a four-gigabyte node_modules — is done.
   *
   * A second call aborts the first. The user pressing refresh twice should not
   * queue two scans that then race each other's writes.
   */
  public async rescanAll(
    repositories: ReadonlyArray<IScannableRepository>,
    measureArtifacts: boolean = true
  ): Promise<void> {
    this.abortController?.abort()
    const controller = new AbortController()
    this.abortController = controller

    await this.rescanGlobalContext()

    // Drop cached rows for repositories the user has since removed, so the
    // center doesn't report on projects that are gone.
    await this.db.pruneTo(new Set(repositories.map(r => r.id)))
    for (const id of [...this.inventories.keys()]) {
      if (!repositories.some(r => r.id === id)) {
        this.inventories.delete(id)
      }
    }

    this.setProgress({
      scanning: true,
      completed: 0,
      total: repositories.length,
    })

    const queue = [...repositories]
    let completed = 0

    const worker = async (): Promise<void> => {
      while (true) {
        if (controller.signal.aborted) {
          return
        }

        const repository = queue.shift()
        if (repository === undefined) {
          return
        }

        try {
          const inventory = await scanRepository(
            repository.id,
            repository.path,
            this.now(),
            { measureArtifacts, signal: controller.signal }
          )

          if (controller.signal.aborted) {
            return
          }

          this.inventories.set(repository.id, inventory)
          await this.db.putInventory(inventory)
        } catch (e) {
          if (controller.signal.aborted) {
            return
          }
          // One repository failing is not a reason to abandon the rest. The
          // scanner already turns most failures into an error status; this
          // catches whatever it could not.
          this.emitError(e instanceof Error ? e : new Error(String(e)))
        }

        completed++
        this.setProgress({
          scanning: true,
          completed,
          total: repositories.length,
        })
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(ScanConcurrency, repositories.length) },
        worker
      )
    )

    if (controller.signal.aborted) {
      return
    }

    this.abortController = null
    this.setProgress({
      scanning: false,
      completed,
      total: repositories.length,
    })
  }

  /** Rescan one repository, leaving the others alone. */
  public async rescanRepository(
    repository: IScannableRepository,
    measureArtifacts: boolean = true
  ): Promise<void> {
    const inventory = await scanRepository(
      repository.id,
      repository.path,
      this.now(),
      { measureArtifacts }
    )

    this.inventories.set(repository.id, inventory)
    await this.db.putInventory(inventory)
    this.emitUpdate()
  }

  /**
   * Delete reclaimable directories, then rescan the repository so the reported
   * sizes reflect what is actually on disk rather than what was there before.
   */
  public async cleanUp(
    repository: IScannableRepository,
    relativePaths: ReadonlyArray<string>,
    options: ICleanupOptions
  ): Promise<ReadonlyArray<CleanupOutcome>> {
    const outcomes: Array<CleanupOutcome> = []

    for (const relativePath of relativePaths) {
      outcomes.push(
        await deleteArtifact(repository.path, relativePath, options)
      )
    }

    await this.rescanRepository(repository)

    return outcomes
  }

  private setProgress(progress: IScanProgress): void {
    this.progress = progress
    this.emitUpdate()
  }
}
