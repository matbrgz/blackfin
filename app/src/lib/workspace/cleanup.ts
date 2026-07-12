import { rm, lstat, readdir } from 'fs/promises'
import * as Path from 'path'
import { resolveWithin } from '../path'
import { classifyArtifact } from './catalog'
import { ArtifactKind } from '../../models/workspace-inventory'

/**
 * Deleting reclaimable directories.
 *
 * This is the one part of the workspace feature that destroys data, so it is
 * paranoid on purpose. Every deletion is checked before it happens: the path
 * must resolve inside the repository, it must be a real directory rather than a
 * symlink, and it must *still* classify as an artifact at the moment we delete
 * it — not merely have done so when the inventory was taken. A bug here costs
 * somebody their work, and no amount of convenience is worth that.
 *
 * The trash function is injected rather than imported so that this module never
 * pulls in Electron, and so the refusal logic can be tested without a running
 * app.
 */

export type CleanupOutcome =
  | { readonly kind: 'deleted'; readonly relativePath: string }
  | {
      readonly kind: 'refused'
      readonly relativePath: string
      readonly reason: string
    }
  | {
      readonly kind: 'failed'
      readonly relativePath: string
      readonly message: string
    }

export type DeletableCheck =
  | {
      readonly ok: true
      readonly absolutePath: string
      readonly kind: ArtifactKind
    }
  | { readonly ok: false; readonly reason: string }

export interface ICleanupOptions {
  /**
   * Move to the trash rather than unlinking. An unrecoverable `rm -rf` of a
   * directory somebody actually needed is the worst thing this feature could
   * do, and the trash costs nothing.
   */
  readonly moveToTrash: boolean
  /** Injected so this module stays free of Electron. */
  readonly moveItemToTrash: (path: string) => Promise<void>
}

/** Verify a repository-relative path is safe to delete, without deleting it. */
export async function checkDeletable(
  repositoryPath: string,
  relativePath: string
): Promise<DeletableCheck> {
  const root = Path.resolve(repositoryPath)
  const candidate = Path.resolve(root, relativePath)

  // Refuse to delete the repository itself, however we got here.
  if (candidate === root) {
    return { ok: false, reason: 'Refusing to delete the repository root' }
  }

  // A lexical containment check first, so that an escaping path is reported as
  // escaping rather than as whatever the symlink-aware resolver happens to say
  // about it.
  const lexical = Path.relative(root, candidate)
  if (lexical.startsWith('..') || Path.isAbsolute(lexical)) {
    return { ok: false, reason: 'Path is outside the repository' }
  }

  let info
  try {
    info = await lstat(candidate)
  } catch {
    return { ok: false, reason: 'Directory no longer exists' }
  }

  // Following a symlink to delete its target is exactly the bug that eats
  // somebody's home directory.
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return { ok: false, reason: 'Not a directory' }
  }

  // Now the real guarantee: resolveWithin follows symlinks, so a path that is
  // lexically inside the repository but whose parents link out of it is caught
  // here. It needs the path to exist, which is why it runs after the lstat.
  let absolutePath: string | null
  try {
    absolutePath = await resolveWithin(repositoryPath, relativePath)
  } catch {
    return { ok: false, reason: 'Path could not be resolved safely' }
  }

  if (absolutePath === null) {
    return { ok: false, reason: 'Path is outside the repository' }
  }

  // Re-classify from scratch rather than trusting the caller's inventory, which
  // may be minutes stale.
  const basename = Path.basename(absolutePath)
  const parent = Path.dirname(absolutePath)

  let siblings: Set<string>
  try {
    siblings = new Set(await readdir(parent))
  } catch {
    return { ok: false, reason: 'Parent directory could not be read' }
  }

  const kind = classifyArtifact(basename, name => siblings.has(name))
  if (kind === null) {
    return {
      ok: false,
      reason: 'No longer classifies as a reclaimable directory',
    }
  }

  return { ok: true, absolutePath, kind }
}

/**
 * Delete one artifact directory. Never throws: a failure is an outcome, because
 * a cleanup across twenty repositories must not abandon the other nineteen
 * because one directory was locked by a running dev server.
 */
export async function deleteArtifact(
  repositoryPath: string,
  relativePath: string,
  options: ICleanupOptions
): Promise<CleanupOutcome> {
  const check = await checkDeletable(repositoryPath, relativePath)

  if (!check.ok) {
    return { kind: 'refused', relativePath, reason: check.reason }
  }

  try {
    if (options.moveToTrash) {
      await options.moveItemToTrash(check.absolutePath)
    } else {
      await rm(check.absolutePath, { recursive: true, force: true })
    }
    return { kind: 'deleted', relativePath }
  } catch (e) {
    return {
      kind: 'failed',
      relativePath,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}
