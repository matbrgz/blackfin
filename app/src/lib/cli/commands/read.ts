// The pure projections behind the six read-only CLI commands (#63):
// `context effective`, `context list`, `context show`, `extension list`,
// `project info` and `worktree info`.
//
// Everything here is a pure function of plain data — the workspace inventory the
// app already holds (`IContextFile`, `IRepositoryInventory`, `IGlobalContext`)
// and the `resolve-cwd` output — and returns the object that becomes the
// response envelope's `data`. No I/O, no store, no `Date.now()`, and it never
// throws: a directory outside every known repository is an honest value
// (`repository: null` + a warning), not an exception.
//
// The one rule that shapes the whole file: metadata never becomes content.
// `toCLIContextEntry` is the single place an `IContextFile` is flattened for the
// wire, and by construction it does not copy `headings`, the file body, or any
// value that could carry a secret. That is where the leak test aims. The richer
// `context show` detail deliberately does carry `headings` — the structural map
// of a file is not its body, and it is exactly the map an agent is buying — but
// it still never carries the content itself.

import {
  ContextScope,
  IContextFile,
  IContextReference,
  IHeading,
} from '../../../models/workspace-inventory'
import { ICwdRepository, ICwdWorktree } from '../resolve-cwd'

/** The hard ceiling on a single CLI response body. Beyond it, a response is a
 * denial-of-service against the agent's own context window, so we truncate and
 * declare it rather than return a wall of tokens. */
export const MaxResponseBytes = 256 * 1024

/** The default page size for `context list`, so an unfiltered list on a machine
 * with many projects does not cost the agent thousands of entries in tokens. */
export const DefaultListLimit = 100

/**
 * The sentence that rides on every *global* entry. It is the whole point of the
 * feature: a rule in `~/.claude/CLAUDE.md` governs the agent here and is
 * invisible from inside this repository, so nothing else in the toolchain can
 * tell the agent it exists.
 */
export const GlobalContextNote =
  'Applies to every project on this machine. It is not visible from inside this repository.'

/** The honest, non-error answer when the cwd is outside every known repository. */
export const NotInRepositoryWarning =
  'This directory is not inside a repository Blackfin knows about. Only global context is reported.'

/** A single catalog entry, flattened for the wire — a subset, never the body.
 * This is the redaction shape: there is no field here a file's content could
 * land in. */
export interface ICLIContextEntry {
  readonly id: string
  readonly scope: 'global' | 'project' | 'worktree'
  readonly agent: string
  readonly role: string
  readonly kind: string
  /** Relative to its scope; a global entry is prefixed with `~/`. */
  readonly path: string
  readonly name: string | null
  readonly description: string | null
  readonly ruleCount: number
  readonly brokenReferences: number
  readonly modifiedAt: number
  /** Reserved for a future content hash (not yet in the inventory model). */
  readonly contentHash: string | null
  /** Present only on global entries: the phrase that explains the invisible reach. */
  readonly note?: string
}

export interface ICLIRepositoryRef {
  readonly id: number
  readonly name: string
  readonly gitDir: string
}

export interface ICLIWorktreeRef {
  readonly path: string
  readonly branch: string | null
  readonly isPrimary: boolean
}

export interface ICLIEffectiveContext {
  readonly cwd: string
  readonly repository: ICLIRepositoryRef | null
  readonly worktree: ICLIWorktreeRef | null
  readonly summary: {
    readonly project: number
    readonly global: number
    readonly brokenReferences: number
  }
  readonly entries: ReadonlyArray<ICLIContextEntry>
  readonly warnings: ReadonlyArray<string>
}

/** One page of a paginated list. `total` is always the un-paginated size. */
export interface ICLIPage<T> {
  readonly items: ReadonlyArray<T>
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly truncated: boolean
}

/** A reference a context file points at, projected for the wire. */
export interface ICLIContextReference {
  readonly raw: string
  readonly target: string
  readonly exists: boolean
}

/** The `context show` detail: the structural map of one file — headings, rule
 * count, references and broken references — but never its body. */
export interface ICLIContextDetail {
  readonly id: string
  readonly scope: 'global' | 'project' | 'worktree'
  readonly agent: string
  readonly role: string
  readonly kind: string
  readonly path: string
  readonly name: string | null
  readonly description: string | null
  readonly ruleCount: number
  readonly headings: ReadonlyArray<IHeading>
  readonly references: ReadonlyArray<ICLIContextReference>
  readonly brokenReferences: ReadonlyArray<ICLIContextReference>
  readonly contentHash: string | null
  readonly modifiedAt: number
  readonly skippedReason: string | null
}

/** `project info`: the project that contains the cwd, plus its context health. */
export interface ICLIProjectInfo {
  readonly id: number
  readonly name: string
  readonly gitDir: string
  readonly branch: string | null
  readonly worktrees: ReadonlyArray<ICLIWorktreeRef>
  readonly contextHealth: {
    readonly contextFiles: number
    readonly brokenReferences: number
  }
}

/** `worktree info`: it degrades gracefully until #55 lands — path, branch and
 * gitDir are always present; `base`, `lineage` and `checkpoint` stay null/empty
 * until worktree lineage exists. */
export interface ICLIWorktreeInfo {
  readonly path: string
  readonly branch: string | null
  readonly gitDir: string
  readonly isPrimary: boolean
  readonly base: string | null
  readonly lineage: ReadonlyArray<string>
  readonly checkpoint: null
}

/** How a context entry is filtered — the same axes `context list` exposes. */
export interface ICLIContextFilters {
  readonly scope?: 'global' | 'project' | 'worktree'
  readonly agent?: string
  readonly kind?: string
}

/** The context in which a file is being flattened: the id it belongs to. */
export interface ICLIEntryContext {
  readonly repositoryId: number | null
  readonly homePath: string
}

// Until #22's `ExtensionKind` lands, a file's `kind` mirrors its `ContextRole`:
// the two vocabularies coincide for everything the inventory produces
// (instructions, skill, command, subagent, prompt, settings, hook).
function kindForRole(role: string): string {
  return role
}

function isGlobal(file: IContextFile): boolean {
  return file.scope === ContextScope.Global
}

/** The path as an agent should read it: a global file gets a `~/` prefix so it
 * is unmistakably outside the repository. */
function displayPath(file: IContextFile): string {
  return isGlobal(file) ? `~/${file.relativePath}` : file.relativePath
}

function entryId(file: IContextFile, repositoryId: number | null): string {
  if (isGlobal(file)) {
    return `global:${file.relativePath}`
  }
  const repo = repositoryId === null ? 'unknown' : String(repositoryId)
  return `repo:${repo}:${file.relativePath}`
}

function countBroken(references: ReadonlyArray<IContextReference>): number {
  let count = 0
  for (const reference of references) {
    if (!reference.exists) {
      count = count + 1
    }
  }
  return count
}

/**
 * Flatten one `IContextFile` into a wire entry. THE redaction choke point: this
 * is the only function that builds an `ICLIContextEntry`, and it copies only a
 * fixed subset of fields — never `headings`, never a body, never anything a
 * secret could hide in. Pure and total.
 */
export function toCLIContextEntry(
  file: IContextFile,
  context: ICLIEntryContext
): ICLIContextEntry {
  const base: ICLIContextEntry = {
    id: entryId(file, context.repositoryId),
    scope: isGlobal(file) ? 'global' : 'project',
    agent: file.agent,
    role: file.role,
    kind: kindForRole(file.role),
    path: displayPath(file),
    name: file.name,
    description: file.description,
    ruleCount: file.ruleCount,
    brokenReferences: countBroken(file.references),
    modifiedAt: file.modifiedAt,
    contentHash: null,
  }
  return isGlobal(file) ? { ...base, note: GlobalContextNote } : base
}

function toCLIReference(reference: IContextReference): ICLIContextReference {
  return {
    raw: reference.raw,
    target: reference.target,
    exists: reference.exists,
  }
}

/**
 * The full `context show` detail for one file. Carries the structural map —
 * headings and references — which is metadata, not the body; the body is never
 * read here. Pure.
 */
export function toCLIContextDetail(
  file: IContextFile,
  context: ICLIEntryContext
): ICLIContextDetail {
  const references = file.references.map(toCLIReference)
  return {
    id: entryId(file, context.repositoryId),
    scope: isGlobal(file) ? 'global' : 'project',
    agent: file.agent,
    role: file.role,
    kind: kindForRole(file.role),
    path: displayPath(file),
    name: file.name,
    description: file.description,
    ruleCount: file.ruleCount,
    headings: file.headings,
    references,
    brokenReferences: references.filter(r => !r.exists),
    contentHash: null,
    modifiedAt: file.modifiedAt,
    skippedReason: file.skippedReason,
  }
}

/** The warning for one broken reference: it names the file and the missing
 * target, and says the rules downstream of it are not in effect — the single
 * most useful thing this feature can tell an agent. */
function brokenReferenceWarning(
  file: IContextFile,
  reference: IContextReference
): string {
  return `Broken reference in ${displayPath(file)}: ${reference.raw} — ${
    reference.target
  } not found. Rules downstream of it are not in effect.`
}

/** The inputs to `context effective`, already resolved to plain data. */
export interface IEffectiveContextInput {
  readonly cwd: string
  readonly repository: ICLIRepositoryRef | null
  readonly worktree: ICLIWorktreeRef | null
  readonly repositoryId: number | null
  readonly homePath: string
  /** The context files that belong to the resolved project (may be empty). */
  readonly projectFiles: ReadonlyArray<IContextFile>
  /** The global context files that reach every project on this machine. */
  readonly globalFiles: ReadonlyArray<IContextFile>
}

/**
 * Build the `context effective` response: everything that governs the cwd.
 * Global entries come first — they are the invisible half — then project
 * entries. Each global entry carries its note; every broken reference becomes a
 * warning; and a cwd outside every repository is answered, not errored. Pure and
 * never paginated: this is the one response that must be complete.
 */
export function buildEffectiveContext(
  input: IEffectiveContextInput
): ICLIEffectiveContext {
  const entryContext: ICLIEntryContext = {
    repositoryId: input.repositoryId,
    homePath: input.homePath,
  }
  const globalEntries = input.globalFiles.map(f =>
    toCLIContextEntry(f, entryContext)
  )
  const projectEntries = input.projectFiles.map(f =>
    toCLIContextEntry(f, entryContext)
  )

  const warnings: Array<string> = []
  // Global first, then project — same ordering as the entries, so warnings read
  // in the order an agent scans the list.
  for (const file of [...input.globalFiles, ...input.projectFiles]) {
    for (const reference of file.references) {
      if (!reference.exists) {
        warnings.push(brokenReferenceWarning(file, reference))
      }
    }
  }
  if (input.repository === null) {
    warnings.push(NotInRepositoryWarning)
  }

  return {
    cwd: input.cwd,
    repository: input.repository,
    worktree: input.worktree,
    summary: {
      project: projectEntries.length,
      global: globalEntries.length,
      brokenReferences:
        countBrokenInFiles(input.globalFiles) +
        countBrokenInFiles(input.projectFiles),
    },
    entries: [...globalEntries, ...projectEntries],
    warnings,
  }
}

function countBrokenInFiles(files: ReadonlyArray<IContextFile>): number {
  let count = 0
  for (const file of files) {
    count = count + countBroken(file.references)
  }
  return count
}

/**
 * Filter a set of already-flattened entries by scope, agent and kind. The CLI
 * does NOT filter on its own — this is a plain intersection over the fields the
 * catalog already stamped, so `--agent x --kind y` is exactly the agent set ∩
 * the kind set. Pure.
 */
export function filterContextEntries(
  entries: ReadonlyArray<ICLIContextEntry>,
  filters: ICLIContextFilters
): ReadonlyArray<ICLIContextEntry> {
  return entries.filter(entry => {
    if (filters.scope !== undefined && entry.scope !== filters.scope) {
      return false
    }
    if (filters.agent !== undefined && entry.agent !== filters.agent) {
      return false
    }
    if (filters.kind !== undefined && entry.kind !== filters.kind) {
      return false
    }
    return true
  })
}

/** The roles that count as an *extension* — what `extension list` reports, and
 * what the Agents screen shows for the same scope. */
const ExtensionRoles = new Set<string>([
  'skill',
  'command',
  'subagent',
  'prompt',
  'hook',
  'settings',
])

/** Whether an entry is an extension (skill / command / subagent / …), as opposed
 * to a standing-instructions file. Pure. */
export function isExtensionEntry(entry: ICLIContextEntry): boolean {
  return ExtensionRoles.has(entry.role)
}

/**
 * The `extension list` projection: the extensions active for a scope, filtered
 * the same way `context list` filters. It shares the exact entries the Agents
 * screen derives from the same inventory, so the two can never disagree. Pure.
 */
export function listExtensions(
  entries: ReadonlyArray<ICLIContextEntry>,
  filters: ICLIContextFilters
): ReadonlyArray<ICLIContextEntry> {
  return filterContextEntries(entries.filter(isExtensionEntry), filters)
}

/**
 * Paginate a list stably. `total` is always the full size; `truncated` is true
 * when the returned window does not reach the end. Pure and total — a negative
 * or oversized offset simply yields an empty window.
 */
export function paginate<T>(
  items: ReadonlyArray<T>,
  limit: number,
  offset: number
): ICLIPage<T> {
  const total = items.length
  const start = Math.max(0, offset)
  const size = Math.max(0, limit)
  const window = items.slice(start, start + size)
  return {
    items: window,
    total,
    limit,
    offset,
    truncated: start + window.length < total,
  }
}

/**
 * Enforce the response byte ceiling on a page's items, dropping trailing items
 * until the serialized array fits and forcing `truncated` when anything is cut.
 * A giant response is never returned as invalid JSON — it is trimmed to a
 * parseable prefix and declared truncated. Pure.
 */
export function capPageByBytes<T>(
  page: ICLIPage<T>,
  maxBytes: number
): ICLIPage<T> {
  const kept: Array<T> = []
  // Account for the enclosing `[]` and the commas between elements.
  let size = 2
  let capped = false
  for (const item of page.items) {
    const encoded = Buffer.byteLength(JSON.stringify(item), 'utf8')
    const addition = encoded + (kept.length > 0 ? 1 : 0)
    if (size + addition > maxBytes) {
      capped = true
      break
    }
    size = size + addition
    kept.push(item)
  }
  if (!capped) {
    return page
  }
  return { ...page, items: kept, truncated: true }
}

/**
 * `project info`: the project that contains the cwd. `branch` is the branch of
 * the worktree the cwd is in; `contextHealth` counts the project's context
 * files and its broken references. Pure.
 */
export function buildProjectInfo(
  repository: ICwdRepository,
  activeWorktree: ICwdWorktree,
  repositoryId: number,
  projectFiles: ReadonlyArray<IContextFile>
): ICLIProjectInfo {
  return {
    id: repositoryId,
    name: repository.name,
    gitDir: repository.commonGitDir,
    branch: activeWorktree.branch,
    worktrees: repository.worktrees.map(toWorktreeRef),
    contextHealth: {
      contextFiles: projectFiles.length,
      brokenReferences: countBrokenInFiles(projectFiles),
    },
  }
}

/** Flatten a resolved worktree into its wire ref. Pure. */
export function toWorktreeRef(worktree: ICwdWorktree): ICLIWorktreeRef {
  return {
    path: worktree.path,
    branch: worktree.branch,
    isPrimary: worktree.isMain,
  }
}

/**
 * `worktree info`: the worktree the cwd is in. Degrades gracefully until #55 —
 * path, branch and gitDir are real; `base`, `lineage` and `checkpoint` stay
 * empty until worktree lineage exists. Pure.
 */
export function buildWorktreeInfo(
  repository: ICwdRepository,
  worktree: ICwdWorktree
): ICLIWorktreeInfo {
  return {
    path: worktree.path,
    branch: worktree.branch,
    gitDir: repository.commonGitDir,
    isPrimary: worktree.isMain,
    base: null,
    lineage: [],
    checkpoint: null,
  }
}
