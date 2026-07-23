import { BaseStore } from './base-store'
import { ExtensionRegistryDatabase } from '../databases/extension-registry-database'
import {
  ExtensionOwnership,
  IInstallation,
  IRegistryEvent,
  RegistryEventKind,
} from '../../models/extension-registry'

/** Fields that identify an installation and may never change after `record()`. */
type InstallationIdentity =
  | 'installId'
  | 'kind'
  | 'agent'
  | 'scope'
  | 'repositoryId'
  | 'rootPath'
  | 'installedAt'

/** A mutable patch: everything except the identity and the derived `updatedAt`. */
export type InstallationUpdate = Partial<
  Omit<IInstallation, InstallationIdentity | 'updatedAt'>
>

/**
 * The durable installation registry store (#35). Reads and writes the ONE base
 * that holds Blackfin's own data. It performs I/O; it does not scan and it does
 * not reconcile — reconciliation is the pure `reconcileInstallations`, which this
 * store feeds with fresh probes at the call site.
 *
 * Two invariants are enforced at write time, because a wrong one silently
 * corrupts the ownership boundary:
 *   - a `Managed` item MUST carry the files Blackfin wrote (else a later update
 *     has nothing to verify and would overwrite hand-edits blindly);
 *   - a `Detected` item MUST NOT carry files (we did not write them, so we hold
 *     no claim over them).
 *
 * `forget()` deletes the row and NEVER touches the filesystem: forgetting is
 * dropping Blackfin's claim, not deleting the user's files (that is #30, and it
 * goes to the trash).
 */
export class ExtensionRegistryStore extends BaseStore {
  public constructor(
    private readonly db: ExtensionRegistryDatabase,
    private readonly now: () => number = () => Date.now()
  ) {
    super()
  }

  public async getInstallations(): Promise<ReadonlyArray<IInstallation>> {
    return this.db.installations.toArray()
  }

  public async getInstallation(
    installId: string
  ): Promise<IInstallation | null> {
    const row = await this.db.installations.get(installId)
    return row ?? null
  }

  /** The append-only event trail for one item, oldest first. */
  public async getEvents(
    installId: string
  ): Promise<ReadonlyArray<IRegistryEvent>> {
    const rows = await this.db.events
      .where('installId')
      .equals(installId)
      .sortBy('at')
    return rows.map(({ id, ...event }) => event)
  }

  /**
   * Record a new installation. Rejects if the ownership/files invariant is
   * violated or if the `installId` or `rootPath` is already taken (the unique
   * index turns a duplicate root into an error, not corruption).
   */
  public async record(installation: IInstallation): Promise<void> {
    this.assertOwnershipInvariant(installation)

    const kind: RegistryEventKind =
      installation.ownership === ExtensionOwnership.Managed
        ? 'installed'
        : 'registered'

    await this.db.transaction(
      'rw',
      this.db.installations,
      this.db.events,
      async () => {
        await this.db.installations.add(installation)
        await this.appendEvent(installation.installId, kind, null)
      }
    )

    this.emitUpdate()
  }

  /** Apply a patch to the mutable fields of an existing installation. */
  public async update(
    installId: string,
    changes: InstallationUpdate
  ): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.installations,
      this.db.events,
      async () => {
        const existing = await this.db.installations.get(installId)
        if (existing === undefined) {
          throw new Error(`No installation with id ${installId} to update.`)
        }

        const next: IInstallation = {
          ...existing,
          ...changes,
          updatedAt: this.now(),
        }
        this.assertOwnershipInvariant(next)

        await this.db.installations.put(next)
        await this.appendEvent(installId, 'updated', null)
      }
    )

    this.emitUpdate()
  }

  /**
   * Drop Blackfin's claim on an item. Removes the registry row and records the
   * act in the append-only trail. Touches NO files on disk.
   */
  public async forget(installId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.installations,
      this.db.events,
      async () => {
        await this.appendEvent(installId, 'forgotten', null)
        await this.db.installations.delete(installId)
      }
    )

    this.emitUpdate()
  }

  private assertOwnershipInvariant(installation: IInstallation): void {
    const hasFiles = installation.files.length > 0
    if (installation.ownership === ExtensionOwnership.Managed && !hasFiles) {
      throw new Error(
        'A managed installation must record the files Blackfin wrote.'
      )
    }
    if (installation.ownership === ExtensionOwnership.Detected && hasFiles) {
      throw new Error(
        'A detected installation must not claim files Blackfin did not write.'
      )
    }
  }

  private async appendEvent(
    installId: string,
    kind: RegistryEventKind,
    detail: string | null
  ): Promise<void> {
    await this.db.events.add({ installId, kind, at: this.now(), detail })
  }
}
