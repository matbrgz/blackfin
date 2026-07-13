import Dexie from 'dexie'
import { BaseDatabase } from './base-database'
import { IRepositoryInventory } from '../../models/workspace-inventory'

/**
 * The cached workspace inventory, one row per repository.
 *
 * This is a standalone database rather than a new table on
 * `RepositoriesDatabase` on purpose: that database holds the user's actual
 * repositories, and a schema migration there to support a cache would put real
 * data at risk to speed up a screen. A cache that is lost is a cache that is
 * rebuilt.
 */

export interface IDatabaseWorkspaceInventory {
  readonly id?: number
  readonly repositoryId: number
  /** The whole inventory, serialised. */
  readonly inventory: IRepositoryInventory
}

export class WorkspaceDatabase extends BaseDatabase {
  public declare inventories: Dexie.Table<IDatabaseWorkspaceInventory, number>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)

    this.conditionalVersion(1, {
      inventories: '++id, &repositoryId',
    })
  }

  public async getInventory(
    repositoryId: number
  ): Promise<IRepositoryInventory | null> {
    const row = await this.inventories
      .where('repositoryId')
      .equals(repositoryId)
      .first()
    return row?.inventory ?? null
  }

  public async getAllInventories(): Promise<
    ReadonlyArray<IRepositoryInventory>
  > {
    const rows = await this.inventories.toArray()
    return rows.map(r => r.inventory)
  }

  public async putInventory(inventory: IRepositoryInventory): Promise<void> {
    await this.transaction('rw', this.inventories, async () => {
      const existing = await this.inventories
        .where('repositoryId')
        .equals(inventory.repositoryId)
        .first()

      if (existing?.id !== undefined) {
        await this.inventories.update(existing.id, { inventory })
      } else {
        await this.inventories.add({
          repositoryId: inventory.repositoryId,
          inventory,
        })
      }
    })
  }

  /**
   * Drop the cache for repositories the user no longer has. Without this the
   * table grows forever and the center reports on projects that were removed
   * months ago.
   */
  public async pruneTo(repositoryIds: ReadonlySet<number>): Promise<void> {
    await this.transaction('rw', this.inventories, async () => {
      const rows = await this.inventories.toArray()
      const stale = rows
        .filter(r => !repositoryIds.has(r.repositoryId))
        .map(r => r.id)
        .filter((id): id is number => id !== undefined)

      if (stale.length > 0) {
        await this.inventories.bulkDelete(stale)
      }
    })
  }
}
