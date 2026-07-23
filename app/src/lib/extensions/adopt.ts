import * as Path from 'path'
import {
  anchorFor,
  CapabilityKind,
  CapabilityScope,
  IDetectedCapability,
} from '../../models/extension'
import {
  ExtensionOwnership,
  IInstallation,
} from '../../models/extension-registry'
import { AgentId, ContextScope } from '../../models/workspace-inventory'
import { correlationKeyForAnchor } from './registry-reconcile'

/**
 * Adoption — registering an item that was already on disk (#36), without moving,
 * copying or rewriting a single byte. This module is the PURE projection at the
 * heart of that promise: it turns a scanned `IDetectedCapability` into the
 * `IInstallation` row Blackfin will record. It performs NO I/O (the only import
 * from `path` is string arithmetic on paths, never a filesystem read), it never
 * throws, and it is deterministic.
 *
 * The projection encodes the honesty stance the issue is a test of:
 *   - `ownership` is ALWAYS `Detected`. Blackfin did not write these files and
 *     must never claim it can update or overwrite them. There is no path here
 *     that produces `Managed`.
 *   - `files` is ALWAYS empty. A detected item, even an adopted one, has no
 *     files that are "ours" to verify — so we hold no claim over them, and the
 *     store's ownership invariant (`Detected ⇒ files.length === 0`) accepts it.
 *   - `source` is ALWAYS `null`: an adopted item's origin is unknown by
 *     definition. We refuse to guess a git remote, a URL or a marketplace id
 *     from a folder we merely found. `null` means exactly "provenance unknown".
 *   - `version` comes ONLY from a declared manifest version; never a fabricated
 *     `1.0.0`.
 *   - `name`/`description` are the scanned facts (`logicalName`/`description`),
 *     which the scanner already derived from frontmatter — never invented here.
 */

/**
 * The ambient facts a detected item cannot carry about itself, resolved by the
 * caller from the scan context. Kept out of the pure projection's return value,
 * never persisted beyond what it feeds into the row.
 */
export interface IAdoptionContext {
  /**
   * The agent whose copy is being adopted. An `IDetectedCapability` may list
   * several agents (a portable item); adoption records one row per agent, so the
   * chosen one is passed explicitly rather than guessed from the array.
   */
  readonly agent: AgentId
  /**
   * Absolute root of the SCOPE: the repository root for `Project`, or the agent
   * home directory for `Global`. The item's `relativePath` is resolved against
   * it to get the absolute `rootPath`. This is a string join — no disk access.
   */
  readonly scopeRoot: string
  /**
   * The git directory for project/worktree scope; `null` for global. Feeds the
   * correlation anchor exactly as #35 expects (gitDir, never repositoryId, which
   * mutates when a repo is re-added).
   */
  readonly gitDir: string | null
  /** The repository id for project scope; `null` when the scope is `Global`. */
  readonly repositoryId: number | null
}

/**
 * Map the extension model's three-value `CapabilityScope` onto the durable
 * registry's two-value `ContextScope`. `Worktree` has no `ContextScope` of its
 * own and is recorded as `Project` (a worktree is a project-scoped location);
 * the finer `CapabilityScope` is preserved on the anchor, which is what
 * reconcile correlates on. Pure; never throws.
 */
function contextScopeFor(scope: CapabilityScope): ContextScope {
  switch (scope) {
    case CapabilityScope.Global:
      return ContextScope.Global
    case CapabilityScope.Project:
    case CapabilityScope.Worktree:
      return ContextScope.Project
  }
}

/**
 * The absolute root of the item as adoption records it:
 *   - a Skill roots at its DIRECTORY, not the `SKILL.md` manifest inside it —
 *     the item is the folder, matching how the scanner anchors a skill;
 *   - a Command, Subagent or any other kind roots at its own file.
 * Pure string arithmetic; no filesystem access.
 */
function rootPathFor(
  scopeRoot: string,
  kind: CapabilityKind,
  relativePath: string
): string {
  // POSIX path arithmetic, deterministic on every platform. Native `Path` is
  // `path.win32` on Windows, where `resolve('/repo', rel)` injects the current
  // drive and backslashes — output the model (whose `relativePath` is POSIX)
  // never expects. `join` (not `resolve`) since `scopeRoot` is already absolute;
  // fs accepts forward slashes on Windows, so the stored path stays usable.
  const absolute = Path.posix.join(toPosix(scopeRoot), toPosix(relativePath))
  if (
    kind === CapabilityKind.Skill &&
    Path.posix.basename(absolute).toLowerCase() === 'skill.md'
  ) {
    return Path.posix.dirname(absolute)
  }
  return absolute
}

/** Normalise Windows backslash separators to POSIX forward slashes. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * A stable installId for an adopted item. Derived from the item's hash-
 * INDEPENDENT correlation identity (`scope + agent + kind + logicalName +
 * gitDir`), so it survives moving the folder and hand-editing the file — the
 * same identity reconcile uses to match a row to a scanned item. Two items that
 * differ only in scope (or only in agent) get distinct ids.
 */
function adoptionInstallId(correlationKey: string): string {
  return `adopted:${correlationKey}`
}

/**
 * Project a scanned detected item into the `IInstallation` to register. PURE: no
 * I/O, deterministic, never throws. The result is guaranteed to satisfy the
 * store's `Detected ⇒ files.length === 0` invariant and to carry no fabricated
 * provenance.
 */
export function adoptionFromDetected(
  detected: IDetectedCapability,
  context: IAdoptionContext,
  now: number
): IInstallation {
  const rootPath = rootPathFor(
    context.scopeRoot,
    detected.kind,
    detected.relativePath
  )

  const anchor = anchorFor({
    scope: detected.scope,
    agent: context.agent,
    kind: detected.kind,
    logicalName: detected.logicalName,
    contentHashAtInstall: detected.contentHash,
    gitDir: context.gitDir,
    lastKnownPath: rootPath,
  })

  return {
    installId: adoptionInstallId(correlationKeyForAnchor(anchor)),
    kind: detected.kind,
    agent: context.agent,
    scope: contextScopeFor(detected.scope),
    repositoryId: context.repositoryId,
    rootPath,
    ownership: ExtensionOwnership.Detected,
    // Unknown by definition — Blackfin did not install this item. Never guessed.
    source: null,
    sourceRef: null,
    anchor,
    // The scanner's facts, straight through. `logicalName` is already the
    // frontmatter name or a sanitized basename; never invented here.
    name: detected.logicalName,
    description: detected.description,
    // Only a manifest-declared version counts. Never a fabricated default.
    version: detected.manifest?.version ?? null,
    // We wrote nothing, so we claim nothing. Satisfies the store invariant.
    files: [],
    // The detected model carries no granted permissions; we assert none.
    declaredPermissions: [],
    pinned: false,
    installedAt: now,
    updatedAt: now,
  }
}
