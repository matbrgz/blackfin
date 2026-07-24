/**
 * The extension domain model — the pure, testable core of issue #21.
 *
 * This file is STRICTLY ADDITIVE. It sits beside the shipped workspace
 * inventory (`workspace-inventory.ts`) and its classifiers (`catalog.ts`) and
 * removes nothing from them: `ContextRole`, `IContextFile`, `ContextScope` and
 * every existing pure function are untouched, and the scanners never learn this
 * file exists. It materialises the two ratified RFCs —
 *   docs/superpowers/rfcs/2026-07-12-taxonomy.md      (#10, Option C)
 *   docs/superpowers/rfcs/2026-07-12-extension-model.md (#11, RATIFIED)
 * — into concrete types and pure functions.
 *
 * The load-bearing idea is a boundary, not a hierarchy: filesystem truth
 * (Side A, `IDetectedCapability`) and Blackfin-managed data (Side B,
 * `IExtensionRecord`) NEVER merge into one row. They are united only by a pure
 * `reconcile()` producing a derived view (`IReconciledCapability`) that is never
 * persisted. If that boundary leaks, a cache prune deletes the user's trust
 * decisions — which is why the two are separate types with no shared field.
 *
 * Everything here is PURE: no I/O, no throwing, deterministic.
 */

import { AgentId, ContextRole, ContextScope } from './workspace-inventory'
import type { IContextReference } from './workspace-inventory'

// ─────────────────────────────────────────────────────────────
// The five dimensions (RFC #11 §5). Each type is marked with where its truth
// lives: [disk], [blackfin], or [computed].
// ─────────────────────────────────────────────────────────────

/**
 * kind — the unit of effect (the ratified taxonomy's `CapabilityKind`).
 *
 * There is deliberately NO `plugin` member: a plugin is an Extension whose
 * manifest provides more than one Capability — container by cardinality, not by
 * special kind (taxonomy §6.1, RFC #11 D6). There is deliberately NO `settings`
 * member: a settings file is a *container* of capabilities (it declares
 * mcp-servers), not a capability itself (RFC #11 D2). Both omissions are the
 * point, not gaps to be "fixed".
 */
export enum CapabilityKind {
  Instruction = 'instruction', // CLAUDE.md, AGENTS.md, .cursorrules
  Skill = 'skill', // a directory with SKILL.md
  Command = 'command',
  Subagent = 'subagent',
  Prompt = 'prompt', // survives as a kind — RFC #11 D2
  Hook = 'hook',
  McpServer = 'mcp-server', // new: absent from the shipped domain
}

/**
 * scope — where a capability physically lives, and therefore how far it reaches.
 *
 * This is the shipped `ContextScope` (`workspace-inventory.ts:71-76`) plus
 * `Worktree` (RFC #11 D5). It is a NEW enum rather than a mutation of
 * `ContextScope`, to keep this change additive: nothing that switches on
 * `ContextScope` today is forced to grow a case. The string values are shared
 * with `ContextScope` for `global`/`project`, so mapping is lossless.
 *
 * `inherited` and `overridden` are NOT members here: they are relations between
 * two items and the absence of a third, computed at read time and never stored
 * (RFC #11 §5.2, §15a). See `ExtensionRelation`.
 */
export enum CapabilityScope {
  Global = 'global', // ~ ; applies to every project on this machine
  Project = 'project', // inside a repository
  Worktree = 'worktree', // a specific worktree of a repository
}

/**
 * source — where an item came from. [blackfin], except `detected`.
 *
 * `detected` is NOT a member: a detected item is one for which NO
 * `IExtensionRecord` exists. Detection is the ABSENCE of a record (RFC #11 §5.3,
 * taxonomy §5.4). Blackfin never invents provenance for a file it merely found.
 */
export enum ExtensionSource {
  InstalledByBlackfin = 'installed-by-blackfin',
  Marketplace = 'marketplace',
  Git = 'git',
  Url = 'url',
}

/** The sentinel for "no record exists" — the reconciled source of a bare disk item. */
export const DETECTED = 'detected'
export type DetectedSource = typeof DETECTED

/** A reconciled source: a real record's source, or the detected sentinel. */
export type ReconciledSource = ExtensionSource | DetectedSource

/**
 * state — a discriminated union with three distinct origins (RFC #11 §5.4).
 * Conflating them is the classic bug, so they are kept apart:
 *   - `disabled`  [computed] from disk (RATIFIED D4: disable edits the config;
 *                 Blackfin reads the disabled fact back, it is never a stored lie)
 *   - `broken`    [computed] from disk (an unresolved reference)
 *   - `outdated`  [computed] but needs a registry (#13) — a `detected` item can
 *                 NEVER be outdated, and this pure core never produces it
 *   - `enabled`   the default: the absence of the other three
 */
export type ExtensionState =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'broken'; readonly reason: string }
  | { readonly kind: 'outdated'; readonly available: string }

/**
 * manifest — structured extension metadata. EVERY field is nullable, because a
 * `.cursorrules` has no manifest and a `SKILL.md` frontmatter carries only
 * `name`/`description` today (RFC #11 §5.5). The UI must behave with all null.
 */
export interface IExtensionManifest {
  readonly name: string | null
  readonly version: string | null
  readonly description: string | null
  readonly author: string | null
  readonly license: string | null
  readonly homepage: string | null
  /** Capabilities this extension CONTAINS. Cardinality > 1 ⇒ a "plugin". */
  readonly provides: ReadonlyArray<CapabilityKind>
  /** MCP servers it DEPENDS ON without containing. Nobody installs a requirement. */
  readonly requiresMcp: ReadonlyArray<string>
}

/**
 * An MCP server declaration.
 *
 * There is NO field for the VALUE of an environment variable, by design and as a
 * property of the type: a field that does not exist cannot be filled, logged or
 * persisted by mistake (RFC #11 §5.5, §13). `envKeys` holds only the NAMES; #45
 * reports each as configured / absent / inherited / externally-stored.
 */
export interface IMcpServer {
  readonly name: string
  readonly transport: 'stdio' | 'http' | 'sse'
  readonly command: string | null
  readonly args: ReadonlyArray<string>
  /** Only the NAMES of the variables. Never the values. See #45. */
  readonly envKeys: ReadonlyArray<string>
  /** The file that declares this server. */
  readonly declaredIn: string
}

// ─────────────────────────────────────────────────────────────
// SIDE A — FILESYSTEM truth. Derived, throwaway, cacheable.
// NO field below is written by Blackfin. If one is, the model has broken.
// ─────────────────────────────────────────────────────────────

/**
 * What the disk shows — the taxonomy's Capability, with disk-derived fields.
 * Supersedes `IContextFile` for the extension model; the shipped `IContextFile`
 * remains the scanner's output and is the raw material an adapter maps here.
 *
 * Note there is NO `extensionId` field: putting a Blackfin-owned id on the disk
 * object would itself violate the boundary. The taxonomy's `extensionId: null`
 * becomes, one level up, "no matching `IExtensionRecord`" — resolved by
 * `reconcile()`, never stamped onto this row (RFC #11 §5.6).
 */
export interface IDetectedCapability {
  readonly kind: CapabilityKind // [disk]
  readonly scope: CapabilityScope // [disk]
  readonly agents: ReadonlyArray<AgentId> // [disk] — more than one ⇒ portable
  readonly relativePath: string // [disk] — still the truth of where it is
  /** Frontmatter `name`, else the basename. Never invented, never a path. */
  readonly logicalName: string // [disk]
  readonly description: string | null // [disk]
  /** Normalised content hash. Basis of the anchor and of edit detection. */
  readonly contentHash: string // [disk]
  readonly modifiedAt: number // [disk]
  /** References that do not resolve ⇒ `broken`. Recomputed, never stored. */
  readonly references: ReadonlyArray<IContextReference> // [disk/computed]
  /**
   * The disabled fact, read BACK from disk (RATIFIED D4, §11). Disabling is an
   * explicit user edit of the agent's config; Blackfin reads the result, it does
   * not store an opinion. So it lives on Side A, not on the record — it can never
   * be a lie.
   */
  readonly disabled: boolean // [disk]
  /** Absent on most real items. ALL fields nullable. */
  readonly manifest: IExtensionManifest | null // [disk]
  /** Present only when kind === 'mcp-server'. Never carries an env value. */
  readonly mcp: IMcpServer | null // [disk]
}

// ─────────────────────────────────────────────────────────────
// SIDE B — BLACKFIN data. Real, non-throwaway, NEVER in the cache.
// NO field below can be derived from disk. Provenance only — no state datum,
// because the one state that is disk-truth (`disabled`) lives on Side A.
// ─────────────────────────────────────────────────────────────

/**
 * The correlation anchor (RFC #11 §6, §7.2, RATIFIED §15b). Stable under
 * rename, move and hand-edit. NEVER a line index; NEVER `repositoryId` (which
 * mutates when a repo is re-added or a worktree switched — D5). For
 * project/worktree scope it anchors on `gitDir`.
 */
export interface IExtensionAnchor {
  readonly scope: CapabilityScope
  readonly agent: AgentId
  readonly kind: CapabilityKind
  readonly logicalName: string
  /** The hash AT INSTALL TIME. Differs from the current hash ⇒ hand-edited. */
  readonly contentHashAtInstall: string
  /** project/worktree scope: gitDir, NOT repositoryId (which mutates — D5). */
  readonly gitDir: string | null
  /** A resolution HINT only. Never the key. */
  readonly lastKnownPath: string
}

/**
 * What Blackfin knows about an item it installed — install provenance ONLY
 * (RFC #11 §6, ratified §5.4). No `disabled` here: that is a disk fact on
 * Side A. No token, secret or env value here, ever.
 */
export interface IExtensionRecord {
  readonly id: string
  readonly anchor: IExtensionAnchor
  readonly source: ExtensionSource // [blackfin]
  readonly sourceRef: string | null // [blackfin] URL, git remote, marketplace id
  readonly installedVersion: string | null // [blackfin]
  readonly pinnedVersion: string | null // [blackfin]
  readonly installedAt: number // [blackfin]
  /** Trust: DEFINED in #12. Here we only reserve the slot. */
  readonly trust: unknown // [blackfin]
}

// ─────────────────────────────────────────────────────────────
// THE VIEW — what the UI reads. Computed by reconcile(). NEVER persisted.
// ─────────────────────────────────────────────────────────────

/**
 * The inherited/overridden relation (RFC #11 §5.2). A COMPUTED relation between
 * items, never a scope value and never stored — the same shape of fact as
 * `broken` (`IContextReference.exists`), resolved at read time.
 */
export type ExtensionRelation =
  | { readonly kind: 'inherited'; readonly from: CapabilityScope }
  | { readonly kind: 'overridden'; readonly by: CapabilityScope }
  | { readonly kind: 'none' }

/**
 * The reconciled view of one capability. `detected: null` ⇒ an orphan record
 * (the installed file is gone). `record: null` ⇒ `source: 'detected'`. Held in
 * memory, handed to the UI, and DISCARDED — persisting it would fuse the two
 * sides and is rejected in review (RFC #11 §8).
 */
export interface IReconciledCapability {
  readonly detected: IDetectedCapability | null
  readonly record: IExtensionRecord | null
  /** `record.source`, or `'detected'` when there is no record. Derived. */
  readonly source: ReconciledSource
  readonly state: ExtensionState
  readonly relation: ExtensionRelation
  /** true ⇒ current contentHash ≠ contentHashAtInstall (a hand-edit). See #29. */
  readonly locallyModified: boolean
}

// ─────────────────────────────────────────────────────────────
// Pure mapping: ContextRole → CapabilityKind (additive; ContextRole unchanged).
// ─────────────────────────────────────────────────────────────

/**
 * Map a shipped `ContextRole` to its `CapabilityKind`, or `null` when the role
 * is not a capability.
 *
 * This is the enum's split, executed WITHOUT touching `ContextRole`:
 *   - Instructions/Skill/Command/Subagent/Prompt/Hook map through 1:1.
 *   - `Settings` → null: a settings file is not a capability, it is a container
 *     that DECLARES mcp-server capabilities. Extracting those servers is I/O over
 *     a real settings file and is deferred (#43); the mapping is modelled here.
 *
 * The switch is exhaustive: adding a `ContextRole` member without deciding its
 * kind breaks COMPILATION here, not runtime. Pure; never throws.
 */
export function capabilityKindForRole(
  role: ContextRole
): CapabilityKind | null {
  switch (role) {
    case ContextRole.Instructions:
      return CapabilityKind.Instruction
    case ContextRole.Skill:
      return CapabilityKind.Skill
    case ContextRole.Command:
      return CapabilityKind.Command
    case ContextRole.Subagent:
      return CapabilityKind.Subagent
    case ContextRole.Prompt:
      return CapabilityKind.Prompt
    case ContextRole.Hook:
      return CapabilityKind.Hook
    case ContextRole.Settings:
      // Dissolves into mcp-server capabilities declared inside the file (D2).
      // There is no 1:1 kind for a Settings *file*: it becomes zero or more
      // mcp-server capabilities, produced by settings extraction (#43), not here.
      return null
    default: {
      // Exhaustiveness guard: a new ContextRole with no decided kind fails to
      // compile here. Unreachable at runtime, so nothing throws.
      const unhandled: never = role
      return unhandled
    }
  }
}

/**
 * Map the shipped two-value `ContextScope` into `CapabilityScope`. `Worktree`
 * has no `ContextScope` source (the scanners do not produce it yet); it enters
 * only where worktree information is known. Pure; never throws.
 */
export function capabilityScopeFromContextScope(
  scope: ContextScope
): CapabilityScope {
  switch (scope) {
    case ContextScope.Global:
      return CapabilityScope.Global
    case ContextScope.Project:
      return CapabilityScope.Project
    default: {
      const unhandled: never = scope
      return unhandled
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Pure identity: logicalName and the anchor / correlation key.
// ─────────────────────────────────────────────────────────────

const MaxLogicalNameLength = 200

/**
 * Normalise a candidate logical name. The `name` comes from third-party
 * frontmatter Blackfin did not write (RFC #11 security, taxonomy §5.2): it must
 * never become a path and never carry control bytes. Separators and controls are
 * stripped, traversal dots collapsed, and length capped. Pure; never throws.
 */
function sanitizeLogicalName(raw: string): string {
  const stripped = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .trim()
  return stripped.slice(0, MaxLogicalNameLength).trim()
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** The basename that identifies an item when it has no frontmatter name. */
function basenameForKind(kind: CapabilityKind, relativePath: string): string {
  const segments = relativePath.split('/').filter(s => s.length > 0)
  if (segments.length === 0) {
    return ''
  }
  const last = segments[segments.length - 1]
  // A skill's identity is its DIRECTORY, not the `SKILL.md` manifest filename.
  if (kind === CapabilityKind.Skill && last.toLowerCase() === 'skill.md') {
    return segments.length >= 2
      ? segments[segments.length - 2]
      : stripExtension(last)
  }
  return stripExtension(last)
}

/**
 * The logical name of a capability: the frontmatter `name` if present, else the
 * basename of the manifest's directory (for a skill) or file. Deterministic and
 * pure; the raw material is `IContextFile.name` (`workspace-inventory.ts:107`).
 *
 * `frontmatterName` is `null` when there is no manifest or no `name` field.
 */
export function logicalNameFor(
  kind: CapabilityKind,
  relativePath: string,
  frontmatterName: string | null
): string {
  if (frontmatterName !== null) {
    const cleaned = sanitizeLogicalName(frontmatterName)
    if (cleaned.length > 0) {
      return cleaned
    }
  }
  const fromPath = sanitizeLogicalName(basenameForKind(kind, relativePath))
  return fromPath.length > 0 ? fromPath : 'unnamed'
}

const KeySeparator = '\u0000'

/**
 * The scope-independent identity of a capability: `kind + agent + logicalName`.
 * This is what makes "the skill `code-review` in Global and in Project is the
 * same skill" sayable — the path is the LOCATION, not the identity (taxonomy
 * §5.2, #23/#24). Pure; never throws.
 */
export function capabilityIdentityKey(
  kind: CapabilityKind,
  agent: AgentId,
  logicalName: string
): string {
  return [kind, agent, logicalName].join(KeySeparator)
}

/** Build a correlation anchor from its parts (RFC #11 §6). Pure. */
export function anchorFor(parts: {
  readonly scope: CapabilityScope
  readonly agent: AgentId
  readonly kind: CapabilityKind
  readonly logicalName: string
  readonly contentHashAtInstall: string
  readonly gitDir: string | null
  readonly lastKnownPath: string
}): IExtensionAnchor {
  return {
    scope: parts.scope,
    agent: parts.agent,
    kind: parts.kind,
    logicalName: parts.logicalName,
    contentHashAtInstall: parts.contentHashAtInstall,
    gitDir: parts.gitDir,
    lastKnownPath: parts.lastKnownPath,
  }
}

/**
 * A stable string key for an anchor: `scope + agent + kind + logicalName +
 * contentHashAtInstall (+ gitDir)` — RATIFIED §15b. Two items differing only in
 * scope produce different keys; two items differing only in agent produce
 * different keys. Pure; never throws.
 */
export function anchorKey(anchor: IExtensionAnchor): string {
  return [
    anchor.scope,
    anchor.agent,
    anchor.kind,
    anchor.logicalName,
    anchor.contentHashAtInstall,
    anchor.gitDir ?? '',
  ].join(KeySeparator)
}

// ─────────────────────────────────────────────────────────────
// Pure reconciliation (RFC #11 §8, §17). No I/O, deterministic, never throws.
// ─────────────────────────────────────────────────────────────

function scopeRank(scope: CapabilityScope): number {
  switch (scope) {
    case CapabilityScope.Global:
      return 0
    case CapabilityScope.Project:
      return 1
    case CapabilityScope.Worktree:
      return 2
  }
}

/**
 * A record may correlate with a detected item only when scope and kind agree and
 * the record's single agent is among the detected item's agents.
 */
function baseMatch(
  detected: IDetectedCapability,
  record: IExtensionRecord
): boolean {
  return (
    detected.scope === record.anchor.scope &&
    detected.kind === record.anchor.kind &&
    detected.agents.includes(record.anchor.agent)
  )
}

/** The disk-derived state of a detected item (RFC #11 §5.4). */
function stateForDetected(detected: IDetectedCapability): ExtensionState {
  // Precedence: an explicitly disabled item is not loaded by the agent, so its
  // disabled status is the most truthful thing to report; only a loadable item's
  // dangling references make it `broken`. `outdated` needs a registry (#13) and
  // is therefore never produced by this pure core.
  if (detected.disabled) {
    return { kind: 'disabled' }
  }
  const brokenReference = detected.references.find(
    reference => !reference.exists
  )
  if (brokenReference !== undefined) {
    return {
      kind: 'broken',
      reason: `Reference ${brokenReference.raw} does not resolve.`,
    }
  }
  return { kind: 'enabled' }
}

/**
 * Compute the inherited/overridden relation for each detected item, following
 * RFC #11 §5.2 exactly:
 *   overridden-by(narrower) ⇔ a same-identity item exists at a narrower scope
 *   inherited(from own scope) ⇔ a global item with no narrower same-identity
 *                               sibling, when a narrower scope is in view
 * The relation is keyed on `capabilityIdentityKey` (kind + agent + logicalName),
 * so two agents' same-named skills never relate. Never persisted.
 */
function relationsByIndex(
  detected: ReadonlyArray<IDetectedCapability | null>
): ReadonlyArray<ExtensionRelation> {
  const groups = new Map<
    string,
    Array<{ index: number; scope: CapabilityScope }>
  >()
  let hasNarrowerScope = false

  detected.forEach((item, index) => {
    if (item === null) {
      return
    }
    if (scopeRank(item.scope) > scopeRank(CapabilityScope.Global)) {
      hasNarrowerScope = true
    }
    // A portable item (multiple agents) participates once per agent identity.
    for (const agent of item.agents.length > 0 ? item.agents : [null]) {
      const key =
        agent === null
          ? `${item.kind}${KeySeparator}${KeySeparator}${item.logicalName}`
          : capabilityIdentityKey(item.kind, agent, item.logicalName)
      const bucket = groups.get(key)
      if (bucket === undefined) {
        groups.set(key, [{ index, scope: item.scope }])
      } else {
        bucket.push({ index, scope: item.scope })
      }
    }
  })

  return detected.map((item, index) => {
    if (item === null) {
      return { kind: 'none' }
    }
    const myRank = scopeRank(item.scope)
    // The narrowest scope, across every identity group this item belongs to,
    // that is strictly narrower than this item.
    let narrowestOverride: CapabilityScope | null = null
    for (const bucket of groups.values()) {
      if (!bucket.some(entry => entry.index === index)) {
        continue
      }
      for (const entry of bucket) {
        if (scopeRank(entry.scope) > myRank) {
          if (
            narrowestOverride === null ||
            scopeRank(entry.scope) > scopeRank(narrowestOverride)
          ) {
            narrowestOverride = entry.scope
          }
        }
      }
    }
    if (narrowestOverride !== null) {
      return { kind: 'overridden', by: narrowestOverride }
    }
    // Not overridden. A global item reaches down into every narrower context in
    // view, so it is inherited by them.
    if (item.scope === CapabilityScope.Global && hasNarrowerScope) {
      return { kind: 'inherited', from: CapabilityScope.Global }
    }
    return { kind: 'none' }
  })
}

/**
 * Unite filesystem truth with Blackfin records into a derived view, WITHOUT ever
 * writing one side into the other. PURE, no I/O, deterministic — this is where
 * the complexity and the tests live (the doctrine of `catalog.ts`/`parse.ts`).
 *
 * Records resolve to detected items in RFC #11 §7.2 order — path+hash, then hash
 * (a moved file), then path (a hand-edit in place), then logicalName — each
 * detected item claimed at most once. Every result is computed:
 *   - source: the record's source, or `'detected'` when there is no record.
 *   - state: `disabled`/`broken` from disk facts; never `outdated` (no registry).
 *   - relation: the computed inherited/overridden projection.
 *   - locallyModified: current hash ≠ hash-at-install.
 * A record with no detected item is an ORPHAN (`detected: null`) — reported,
 * never deleted (D9). The return value is NEVER persisted.
 */
export function reconcile(
  detected: ReadonlyArray<IDetectedCapability>,
  records: ReadonlyArray<IExtensionRecord>
): ReadonlyArray<IReconciledCapability> {
  const detectedUsed = detected.map(() => false)
  const recordForDetected: Array<IExtensionRecord | null> = detected.map(
    () => null
  )
  const recordMatched = records.map(() => false)

  const passes: ReadonlyArray<
    (detectedItem: IDetectedCapability, record: IExtensionRecord) => boolean
  > = [
    // 1. Clean: same path and same content as at install.
    (item, record) =>
      baseMatch(item, record) &&
      item.relativePath === record.anchor.lastKnownPath &&
      item.contentHash === record.anchor.contentHashAtInstall,
    // 2. Moved: content still matches install, even though the path changed.
    (item, record) =>
      baseMatch(item, record) &&
      item.contentHash === record.anchor.contentHashAtInstall,
    // 3. Hand-edited in place: same path, content diverged.
    (item, record) =>
      baseMatch(item, record) &&
      item.relativePath === record.anchor.lastKnownPath,
    // 4. Last resort: same logical name within scope + agent + kind.
    (item, record) =>
      baseMatch(item, record) && item.logicalName === record.anchor.logicalName,
  ]

  for (const predicate of passes) {
    records.forEach((record, recordIndex) => {
      if (recordMatched[recordIndex]) {
        return
      }
      const detectedIndex = detected.findIndex(
        (item, index) => !detectedUsed[index] && predicate(item, record)
      )
      if (detectedIndex !== -1) {
        recordMatched[recordIndex] = true
        detectedUsed[detectedIndex] = true
        recordForDetected[detectedIndex] = record
      }
    })
  }

  const relations = relationsByIndex(detected)

  const results: IReconciledCapability[] = []

  detected.forEach((item, index) => {
    const record = recordForDetected[index]
    results.push({
      detected: item,
      record,
      source: record === null ? DETECTED : record.source,
      state: stateForDetected(item),
      relation: relations[index],
      locallyModified:
        record !== null &&
        // An unread capability (`UnknownContentHash`, the adapter's sentinel for
        // "nobody hashed these bytes") is not a hand-edited one. Without this
        // guard every installed item detected from an inventory — which carries
        // no hash — would report as locally modified the moment it had a record.
        item.contentHash.length > 0 &&
        item.contentHash !== record.anchor.contentHashAtInstall,
    })
  })

  records.forEach((record, recordIndex) => {
    if (recordMatched[recordIndex]) {
      return
    }
    // Orphan: the installed file is gone. Kept and reported, never deleted (D9).
    results.push({
      detected: null,
      record,
      source: record.source,
      state: {
        kind: 'broken',
        reason: 'The installed file is no longer present on disk.',
      },
      relation: { kind: 'none' },
      locallyModified: false,
    })
  })

  return results
}
