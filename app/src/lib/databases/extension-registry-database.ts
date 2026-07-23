import Dexie from 'dexie'
import { BaseDatabase } from './base-database'
import { IInstallation, IRegistryEvent } from '../../models/extension-registry'

/** A registry event as stored: the domain event plus Dexie's autoincrement key. */
export interface IStoredRegistryEvent extends IRegistryEvent {
  readonly id?: number
}

/**
 * Blackfin's durable record of what it installed (#35). The FIRST database of
 * Blackfin's own data, as opposed to a cache of the filesystem.
 *
 * Deliberately a SEPARATE Dexie database, `new ExtensionRegistryDatabase(...)`,
 * never a table inside `WorkspaceDatabase`. That database is a cache — it has a
 * `pruneTo()` and its own comment says losing it is fine, because a scan rebuilds
 * it. This one is the opposite: losing the row that says "I wrote these five
 * files" turns a managed item into orphaned junk nobody can safely remove. There
 * is NO automatic pruning here, by design. Separate durabilities, separate
 * databases (#14).
 *
 * `installId` is the primary key (Blackfin-generated, stable across a folder
 * move). `&rootPath` is unique on purpose: two rows pointing at the same root is
 * always a bug, and the index turns it into an error instead of silent
 * corruption. The events table is append-only.
 */
export class ExtensionRegistryDatabase extends BaseDatabase {
  public declare installations: Dexie.Table<IInstallation, string>
  public declare events: Dexie.Table<IStoredRegistryEvent, number>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)

    this.conditionalVersion(1, {
      installations:
        'installId, &rootPath, ownership, kind, agent, [scope+repositoryId]',
      events: '++id, installId, at',
    })
  }
}
