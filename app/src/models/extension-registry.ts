import { AgentId, ContextScope } from './workspace-inventory'
import { CapabilityKind, ExtensionSource, IExtensionAnchor } from './extension'

/**
 * The installation registry (#35): Blackfin's first store of *durable, own*
 * data — the record of what Blackfin itself put on disk, which is NOT
 * reconstructible by a scan.
 *
 * This layer builds ON the RFC-#11 model shipped in #21 (`./extension`), it does
 * not fork it. It reuses that model's `ExtensionSource`, provenance `sourceRef`
 * convention, and correlation `IExtensionAnchor`/`anchorKey`. It adds only the
 * three things the durable registry needs and the pure model lacked:
 *   1. a per-file hash list, so "modified" can name the exact files that changed
 *      (the pure model carries a single aggregate hash and can only say yes/no);
 *   2. an append-only event trail (installed / updated / … / forgotten);
 *   3. declared permissions and the ownership discriminant.
 *
 * The founding M2 rule this type installs, and that no later issue may dissolve:
 * a *detected* item lives on the filesystem and Blackfin does not own it; a
 * *managed* item is one Blackfin wrote and can therefore update or remove.
 */

/** Who put these files on disk. The founding distinction of M2. */
export enum ExtensionOwnership {
  /** It was already there. Blackfin does not update it and does not remove it. */
  Detected = 'detected',
  /** Blackfin wrote it. Blackfin knows how to undo it. */
  Managed = 'managed',
}

/** A file Blackfin wrote, and the proof it is still the same file. */
export interface IInstalledFile {
  /** POSIX, relative to the item root. */
  readonly relativePath: string
  readonly sha256: string
  readonly byteLength: number
}

/**
 * A permission the manifest DECLARES it wants. Declaring is not granting —
 * granting is the agent's decision, modelled in #12, never asserted here.
 */
export interface IDeclaredPermission {
  readonly id: string
  readonly reason: string | null
}

/**
 * One row of the durable registry. A row exists only for an item Blackfin has a
 * relationship with: a `Managed` item it wrote, or a `Detected` item the user
 * asked it to adopt (#36). A bare disk item has NO row — it is the throwaway
 * inventory's concern, and reconcile reports it as `unregistered-detected`.
 *
 * No token, secret or env value is ever stored here. An MCP item records the
 * NAMES of its env vars (via the reused `IMcpServer` on the disk side); a value
 * is reported by #45 as configured / absent / inherited / externally-stored, and
 * never persisted.
 */
export interface IInstallation {
  /** Blackfin-generated, stable, survives moving the folder. */
  readonly installId: string
  readonly kind: CapabilityKind
  readonly agent: AgentId
  readonly scope: ContextScope
  /** null when `scope === Global`. */
  readonly repositoryId: number | null
  /** Absolute root of the item: the Skill's directory, or the Command's file. */
  readonly rootPath: string
  readonly ownership: ExtensionOwnership
  /**
   * Reused from the RFC-#11 model (#21). Provenance KIND, not location.
   *
   * `null` is the ADOPTION sentinel (#36): Blackfin found this item on disk but
   * did NOT install it, so its origin is genuinely unknown. We refuse to
   * fabricate a git/url/marketplace source for a file we merely detected —
   * guessing provenance is the exact dishonesty adoption exists to avoid. A
   * `Managed` row therefore always carries a real, non-null source; a `Detected`
   * row carries `null` unless Blackfin itself is the installer.
   */
  readonly source: ExtensionSource | null
  /** Reused convention: URL, git remote+ref, or marketplace id. Never a secret. */
  readonly sourceRef: string | null
  /** Reused correlation anchor: stable under rename/move/hand-edit. */
  readonly anchor: IExtensionAnchor
  readonly name: string
  readonly description: string | null
  readonly version: string | null
  /**
   * The files Blackfin wrote. Non-empty iff `ownership === Managed`: a detected
   * item, even one that was adopted, has no files that are "ours" to verify.
   */
  readonly files: ReadonlyArray<IInstalledFile>
  readonly declaredPermissions: ReadonlyArray<IDeclaredPermission>
  readonly pinned: boolean
  readonly installedAt: number
  readonly updatedAt: number
}

export type RegistryEventKind =
  | 'registered'
  | 'installed'
  | 'updated'
  | 'enabled'
  | 'disabled'
  | 'removed'
  | 'forgotten'

/** The append-only provenance trail: what happened to an item, and when. */
export interface IRegistryEvent {
  readonly installId: string
  readonly kind: RegistryEventKind
  readonly at: number
  readonly detail: string | null
}

/**
 * The reconciled state of one item, produced by `reconcileInstallations` and
 * NEVER persisted — it is derived from the durable registry crossed with a fresh
 * scan.
 *
 *   - `managed-clean`         every recorded file is present and its hash matches
 *   - `managed-modified`      at least one recorded file is gone or hand-edited;
 *                             `changed` names exactly those files
 *   - `managed-missing`       the whole item root is gone or unreadable
 *   - `registered-detected`   an adopted detected item (has a row, no files)
 *   - `unregistered-detected` on disk, no row — Blackfin does not own it
 */
export type InstallationState =
  | { readonly kind: 'managed-clean' }
  | {
      readonly kind: 'managed-modified'
      readonly changed: ReadonlyArray<string>
    }
  | { readonly kind: 'managed-missing'; readonly reason: string | null }
  | { readonly kind: 'registered-detected' }
  | { readonly kind: 'unregistered-detected' }

/** The reconciled view of one item. `installId` is null only for a bare disk item. */
export interface IReconciledInstallation {
  readonly installId: string | null
  /**
   * The hash-INDEPENDENT correlation key that matched an installation to a
   * scanned item — `scope + agent + kind + logicalName + gitDir`. It excludes the
   * content hash on purpose: a hand-edited managed item must still correlate to
   * its registry row (otherwise it would be double-counted as both
   * `managed-modified` and `unregistered-detected`). This is the same identity
   * `reconcile`'s `baseMatch` uses in the RFC-#11 model.
   */
  readonly correlationKey: string
  readonly state: InstallationState
}
