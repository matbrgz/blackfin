# RFC — The extension domain model: kind, scope, source, state, manifest

- **Date:** 2026-07-12
- **Issue:** [#11](https://github.com/matbrgz/blackfin/issues/11) — *RFC: The extension domain model — kind, scope, source, state, manifest*
- **Status:** **RATIFIED** by the maintainer. Option C (two stores + a stable anchor + a pure reconciliation) is adopted, and the three genuine forks are ruled on (§15): scope inheritance = **computed relation**; correlation anchor = `scope+agent+kind+logicalName(basename)+contentHashAtInstall`; **disable edits the config** (the never-write invariant is relaxed to *never-write-silently*, §11). #21/#35 implement against these.
- **Depends on:** [#10](https://github.com/matbrgz/blackfin/issues/10) — *RFC: What a Plugin, a Skill, and an MCP server actually are* — **RATIFIED as Option C**. This document builds directly on the ratified taxonomy (`docs/superpowers/rfcs/2026-07-12-taxonomy.md`) and MUST stay consistent with it. Where the two touch, the taxonomy wins.
- **Blocks:** #12 (trust), #13 (registry), #14 (persistence), #21 (migration), #35 (Blackfin-side records), #22 (containment) — and, transitively, all of M1, M2 and M3.
- **Scope of this document:** the fields each ratified noun carries, and the boundary that keeps filesystem truth and Blackfin data from ever merging into one row. No production code. No `catalog.ts` change, no `workspace-inventory.ts` change — that migration is #21.

---

## 1. Problem

#10 decided **which nouns exist**. This RFC decides **which fields each noun carries** —
and it is where the product keeps or loses the property the user made non-negotiable:

> **Filesystem-detected configuration and Blackfin-managed data never mix.**

Today they do not mix, but only by accident: **there is no Blackfin-managed data yet.**
The inventory is 100% derived from disk (`app/src/lib/workspace/scan.ts`,
`scan-global.ts`), the database is a throwaway cache
(`app/src/lib/databases/workspace-database.ts:5-13`), and nothing is installed, enabled,
disabled or annotated. `IContextFile` (`app/src/models/workspace-inventory.ts:95-114`)
has thirteen fields and **every one is derived from disk** — there is no `id`, no
`source`, no `state`, no `enabled`. The boundary has never been tested because there has
never been anything on the other side of it.

The moment M2 introduces *install*, *disable* and *pin version*, the two kinds of data
begin to coexist. Without a boundary drawn *first*, every tool of this kind fails the same
way: an `enabled: boolean` on the object that represents a user's file. From there, Blackfin
either rewrites the user's file to persist its own state, or lies about what is on disk.

Four dimensions the whole product assumes do not exist in the model:

- **kind** — `ContextRole` (`workspace-inventory.ts:32-47`) has seven members, no
  `plugin` and no `mcp-server`.
- **scope** — `ContextScope` (`:71-76`) has exactly two: `Global` and `Project`. No
  **worktree** (despite the fork having real worktrees — `app/src/lib/git/worktree.ts`),
  and no **inherited** / **overridden**, which are precisely what #23 and #24 need to say.
- **source** — does not exist. Nothing distinguishes a `CLAUDE.md` the user hand-wrote
  from one a plugin installed.
- **state** — does not exist. No `enabled`, no `broken`, no `outdated`. An item exists or
  it does not.

And there is no **manifest**: the only structured metadata Blackfin extracts today are two
frontmatter fields, `name` and `description` (`app/src/lib/workspace/parse.ts:29-69`), by a
parser whose own comment declares it is *"not a YAML parser and does not pretend to be."*

## 2. Why it matters

This is the single point of failure of the backlog. #23/#24 cannot be written honestly
("this global rule is being overridden by the project" is a statement about `scope`, and
`ContextScope` cannot represent it). #40 becomes a silent rewrite of the user's files
(with no *Blackfin* place to store "disabled", the only way to disable is to rename or
delete the file — exactly what the boundary forbids). #41 and the whole marketplace have
no subject ("update" presupposes `version` and `source`, neither of which exists). #12 has
nowhere to hang permissions and provenance.

The cost of getting this wrong is not code rework — it is rework of **data already
persisted on the user's machine.**

## 3. Relationship to the ratified taxonomy (#10)

#10 ratified **Option C**. Its vocabulary is load-bearing here and is used verbatim:

- **Extension** — the unit of distribution, trust and versioning. It has an identity, an
  origin, a version and a manifest. Its disk predicate is *a manifest declaring it*
  (Claude Code's `plugin.json`). A hand-written `.cursorrules` is **not** an Extension.
  A "plugin" is an Extension whose manifest provides **more than one** Capability —
  *container by cardinality, not by special type* (taxonomy §6.1). There is **no**
  `kind: 'plugin'`.
- **Capability** — the unit of effect: one of
  `instruction | skill | command | subagent | prompt | hook | mcp-server`. Its identity is
  **content-based** (`contentHash + name`), not path-based. It carries `agents: AgentId[]`
  and `scope`, and belongs to exactly one Extension when installed (`extensionId`) or to
  **none** when merely detected (`extensionId = null`).
- **`requires`** — an Extension may *require* an `mcp-server` Capability without
  *containing* it. Nobody installs a requirement.
- **`extensionId: null`** is the boundary rule made concrete in the type: it is filled
  **only** when Blackfin installed the item, never by inference.

This RFC is the materialisation of that vocabulary into concrete fields, two stores and a
reconciliation. Two reconciliations of the ratified taxonomy against issue #11's original
draft types are recorded as **D2** and **D6** below, because #11 was drafted before #10 was
ratified and its draft `ExtensionKind` still contained a `Plugin` member and an `mcp` (not
`mcp-server`) member. The ratified taxonomy governs; this document adopts its names.

## 4. Current state (grounding)

All of this lives in `feat/workspace-center` (PR #1). **None of it is in `main`.**

- `ContextRole` (`workspace-inventory.ts:32-47`) — `Instructions | Skill | Command |
  Subagent | Prompt | Settings | Hook`. Seven members, no `plugin`, no `mcp-server`.
- `ContextScope` (`:71-76`) — `Global | Project`. The comment (`:63-70`) argues *why*
  scope matters, which is the argument that members are missing.
- `IContextFile` (`:95-114`) — every field disk-derived. No `id`, `source`, `state`,
  `enabled`.
- `IContextReference.exists` (`:89-93`) — the machine for `broken` **already exists** and
  is already computed against the filesystem, never stored. This is the correct precedent.
- `WorkspaceDatabase` (`databases/workspace-database.ts`) — one standalone Dexie store,
  `conditionalVersion(1, { inventories: '++id, &repositoryId' })` (`:28-30`). Header
  doctrine (`:5-13`): *"a cache that is lost is a cache that is rebuilt"*; standalone
  precisely so a cache migration cannot put real data at risk. `pruneTo` (`:73-85`) deletes
  rows for repositories the user removed — correct for a cache, catastrophic for
  installation data.
- Global context is not even persisted — it lives in memory
  (`app/src/lib/stores/workspace-store.ts:61-68`).
- `parseFrontmatter` (`parse.ts:29-69`) — extracts `name` and `description` and nothing
  else; not a YAML parser.
- `BaseDatabase.conditionalVersion` (`databases/base-database.ts:23-37`) — what a new
  standalone database would reuse.
- Scanners never throw (`scan-global.ts:78`: *"The agent simply isn't installed. That's
  not an error, it's an answer."*).
- `CleanupOutcome` (`workspace/cleanup.ts:22-33`) — the precedent that *failure is a
  result, not an exception*; reconciliation follows it.
- `gitDir` is the stable worktree anchor, not `path`: switching worktree **mutates the
  `path` of the existing `Repository` row** (`repositories-store.ts` `switchWorktree`,
  ~`:524`), so `repositoryId` is not stable across worktrees.

## 5. The five dimensions (normative)

Every field below is marked exactly once: **[disk]** derived from the filesystem,
**[blackfin]** owned by Blackfin, or **[computed]** derived and never persisted. This is
Acceptance Criterion 2, satisfied field by field.

| Dimension | Values | Source of truth | Where it lives |
|---|---|---|---|
| **kind** | `instruction` `skill` `command` `subagent` `prompt` `hook` `mcp-server` | **[disk]** — follows from the classification predicate (`catalog.ts`) | Cache |
| **scope** | `global` `project` `worktree` | **[disk]** — follows from where the file is | Cache |
| *inherited / overridden* | (relation, not a value) | **[computed]** — a relation between items | Never persisted |
| **source** | `detected` `installed-by-blackfin` `marketplace` `git` `url` | **[blackfin]**, except `detected` | `detected` = absence of a record |
| **state** | `enabled` `disabled` `broken` `outdated` | Mixed — see §5.4 | See §5.4 |
| **manifest** | (structured metadata) | **[disk]** — it is the extension author's file | Cache |

### 5.1 kind — reconciled with `ContextRole`

`kind` is the ratified taxonomy's **`CapabilityKind`** — the unit of effect. It replaces
`ContextRole` (`workspace-inventory.ts:32-47`), member by member:

| `ContextRole` (today) | `CapabilityKind` (target) | Note |
|---|---|---|
| `Instructions` | `Instruction` | rename to singular; same predicate |
| `Skill` | `Skill` | directory with `SKILL.md` (`catalog.ts:204-206`) |
| `Command` | `Command` | — |
| `Subagent` | `Subagent` | — |
| `Prompt` | `Prompt` | **survives** — see D2 |
| `Hook` | `Hook` | — |
| `Settings` | *(removed)* | **dissolves** — see D2 |
| — | `McpServer` | **new** — absent from the domain today |

Two normative reconciliations, both grounded in the ratified taxonomy:

- **`Settings` is not a kind; it dissolves into the items it contains (D2).** `Settings`
  (`workspace-inventory.ts:43`) is not a type of capability — it is a *file that contains*
  capabilities. A `settings.json` (or `mcp.json`) declaring three MCP servers must produce
  **three items of `kind: 'mcp-server'`**, not one item of `kind: 'settings'`. This is
  exactly the error `catalog.ts:182` makes today, where `'mcp.json'` is a name in
  `SettingsFiles` and its content is never read. A settings file with no recognised
  declarations inside it yields **no** capability — it is machine config, and the taxonomy's
  translation table keeps it classifying as `Settings` at the file level for display, but it
  is **not** a `CapabilityKind`.
- **`Prompt` survives as a kind (D2).** A prompt is a real artifact with its own body
  (`.claude/prompts/*.md`, `.github/prompts/*.prompt.md`); it is not a container of other
  things. It stays.
- **There is no `plugin` kind (D6).** #11's original draft listed `plugin` as a `kind`; the
  ratified taxonomy (§6.1) resolved that a plugin is an **Extension** whose manifest provides
  more than one Capability — *container by cardinality*. Containment is a relation, not a
  kind. `kind` is single-valued (D7).

```ts
// ─────────────────────────────────────────────────────────────
// SIDE A — FILESYSTEM truth. Derived, throwaway, cacheable.
// This is the ratified taxonomy's Capability, materialised with disk-derived
// fields. It supersedes IContextFile (workspace-inventory.ts:95-114).
// NO field below is written by Blackfin. If one is, the model has broken.
// ─────────────────────────────────────────────────────────────

/** The unit of effect. The ratified taxonomy's CapabilityKind. */
export enum CapabilityKind {
  Instruction = 'instruction', // CLAUDE.md, AGENTS.md, .cursorrules
  Skill = 'skill', // a directory with SKILL.md
  Command = 'command',
  Subagent = 'subagent',
  Prompt = 'prompt', // survives — D2
  Hook = 'hook',
  McpServer = 'mcp-server', // NEW: absent from the domain today
  // No `plugin`: a plugin is an Extension providing > 1 Capability — D6.
  // No `settings`: a settings file is a CONTAINER of capabilities — D2.
}
```

### 5.2 scope — worktree enters; inheritance is a computed relation

```ts
/** ContextScope (workspace-inventory.ts:71-76) + worktree. */
export enum CapabilityScope {
  Global = 'global', // ~ ; applies to every project on this machine
  Project = 'project', // inside a repository
  Worktree = 'worktree', // a specific worktree of a repository
}
```

- **`worktree` enters `scope` (D5).** The fork has real worktrees
  (`app/src/lib/git/worktree.ts`). A worktree is **not** a separate `Repository` row:
  switching worktree mutates the `path` of the existing row (`repositories-store.ts`
  `switchWorktree`, ~`:524`), and `gitDir` is the stable anchor. Therefore **`repositoryId`
  is not a stable key for worktree scope**, and any Blackfin record with worktree scope must
  anchor on `gitDir` + worktree path, never on `repositoryId` (§7, D5). This also exposes
  that today's cache, keyed on `&repositoryId` (`workspace-database.ts:29`), is already
  fragile under worktrees — that is #14's problem, but it is born here.

- **`inherited` and `overridden` are NOT members of `scope`. They are a computed relation
  (recommended, and this is the reasoned decision the task asks for).** The reasoning:

  1. **Encoding them as scopes creates impossible states.** `scope: 'inherited'` — inherited
     *from where*? A scope is *where the file physically is*, a disk fact with one answer.
     "Inherited" is a fact about *two* items and the absence of a third. Collapsing a binary
     relation into a unary enum destroys the second operand.
  2. **It would break the scanner's purity.** To label an item `inherited`, the scanner
     would have to know about items in *other* scopes it did not scan. The scanner is pure,
     per-scope and never throws (`scan-global.ts:78`); it must not reach across scopes.
  3. **It matches the codebase's existing correct precedent.** `broken` is already computed,
     not stored (`IContextReference.exists`, `:89-93`). Inheritance is the same shape of
     fact — a relation resolved at read time, never persisted.

  **Rule of computation** (which #23/#24 consume, and neither persists): a `global` item is
  *inherited* by a project when no item of the same `kind` + `logicalName` exists in that
  project; it is *overridden* when such an item does exist. Formally, for the same
  (`kind`, `logicalName`, `agent`):

  ```
  inherited-by(P)  ⇔  exists global item  ∧  ¬ exists project-P item
  overridden-by(P) ⇔  exists global item  ∧    exists project-P item
  ```

  The relation is a projection over the reconciled view (§8), computed in memory, never
  written to any store.

### 5.3 source — `detected` is the absence of a record

```ts
// ─────────────────────────────────────────────────────────────
// SIDE B — BLACKFIN data. Real, non-throwaway, NEVER in the cache.
// NO field below can be derived from disk. If one can, it belongs to Side A.
// ─────────────────────────────────────────────────────────────

export enum ExtensionSource {
  InstalledByBlackfin = 'installed-by-blackfin',
  Marketplace = 'marketplace',
  Git = 'git',
  Url = 'url',
  // 'detected' is NOT here. Detected = the ABSENCE of an IExtensionRecord. (D4/taxonomy §5.4)
}
```

`source: 'detected'` is not a stored value — it is the absence of an `IExtensionRecord`
matching a detected item. This is the boundary expressed as a type: if a record exists, the
source is on the record; if none exists, the source *is* `detected`, by construction.
Blackfin **never** invents provenance for a file it found. Guessing that a skill "probably
came from plugin X" fabricates provenance, and fabricated provenance is the false ground on
which #12 would build wrong decisions.

### 5.4 state — three different origins, and conflating them is the bug

`state` is not one thing. It decomposes into three, and confusing them is the classic
failure:

- **`broken` — [computed], a disk fact.** An `@import` that does not resolve
  (`parse.ts` reference resolution; `IContextReference.exists`, `workspace-inventory.ts:89-93`
  — the machine already exists), a plugin pointing at a `SKILL.md` that is not there.
  **Never stored** — recomputed on every scan.
- **`outdated` — [computed], but requires Blackfin + registry data.** Needs
  `IExtensionRecord.installedVersion` (Blackfin) **and** the registry's available version
  (#13). Without a record it does not exist: a `detected` item can **never** be `outdated`,
  and the UI must not pretend it can (explicit negative assertion in §9).
- **`disabled` — [computed], read from disk** (RATIFIED D4, §11). Disabling is an explicit
  user operation that edits the config (moves the capability aside / edits the agent's config);
  Blackfin then *reads the disabled state back* from disk on the next scan, exactly like
  `broken`. It is **not** a pure-Blackfin datum and is **not** stored as one — so it can never
  be a lie. There is therefore **no** pure-Blackfin *state* datum for a detected item; Blackfin's
  own data (§6) is install provenance only.
- `enabled` is the default — the absence of `disabled`, `broken` and `outdated`.

```ts
export type ExtensionState =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled' } //                         [computed] from Side A (disk)
  | { readonly kind: 'broken'; readonly reason: string } //  [computed] from Side A
  | { readonly kind: 'outdated'; readonly available: string } // [computed] A + B + registry
```

### 5.5 manifest — optional, and absence is the common case

A `.cursorrules` has no manifest. A `SKILL.md` has frontmatter, but the current parser reads
only `name` and `description` (`parse.ts:29-69`, not a YAML parser). The model **must not
require** a manifest for an item to exist. Normative rule: *every manifest field is nullable,
and the UI must behave well with all of them null* — because that is most developers' setup
today.

```ts
export interface IExtensionManifest {
  readonly name: string | null
  readonly version: string | null
  readonly description: string | null
  readonly author: string | null
  readonly license: string | null
  readonly homepage: string | null
  /** Capabilities this extension CONTAINS. Cardinality > 1 ⇒ "plugin". */
  readonly provides: ReadonlyArray<CapabilityKind>
  /** MCP servers it DEPENDS ON without containing. Nobody installs a requirement. */
  readonly requiresMcp: ReadonlyArray<string>
}

/**
 * An MCP server. Non-existent in the domain today: `mcp.json` is only a name in
 * SettingsFiles (catalog.ts:177-183) and its content is never opened.
 *
 * THERE IS NO FIELD FOR THE VALUE OF AN ENVIRONMENT VARIABLE. This is deliberate,
 * and it is a property of the TYPE, not a convention: a field that does not exist
 * cannot be filled by mistake, logged by mistake, or persisted by mistake.
 */
export interface IMcpServer {
  readonly name: string
  readonly transport: 'stdio' | 'http' | 'sse'
  readonly command: string | null
  readonly args: ReadonlyArray<string>
  /** Only the NAMES of the variables. Never the values. See #45. */
  readonly envKeys: ReadonlyArray<string>
  /** The file that declares this server, and where inside it. */
  readonly declaredIn: string
}
```

### 5.6 Side A, assembled

```ts
export interface IDetectedCapability {
  readonly kind: CapabilityKind // [disk]
  readonly scope: CapabilityScope // [disk]
  readonly agents: ReadonlyArray<AgentId> // [disk] — more than one ⇒ portable
  readonly relativePath: string // [disk] — still the truth of where it is
  /** Frontmatter `name`, or the basename. Never invented. */
  readonly logicalName: string // [disk]
  readonly description: string | null // [disk]
  /** Normalised content hash. The basis of the anchor and of edit detection. */
  readonly contentHash: string // [disk]
  readonly modifiedAt: number // [disk]
  /** References that do not resolve ⇒ `broken`. Recomputed, never stored. */
  readonly references: ReadonlyArray<IContextReference> // [disk/computed]
  /** Absent on most real items. ALL fields nullable. */
  readonly manifest: IExtensionManifest | null // [disk]
  /** Present only when kind === 'mcp-server'. Never carries an env value. */
  readonly mcp: IMcpServer | null // [disk]
}
```

Note there is **no `extensionId` field on `IDetectedCapability`.** The ratified taxonomy
carries `extensionId: string | null` on the Capability as the boundary line; in the
materialised two-store model, putting a Blackfin-owned id on the disk object would *itself*
violate the invariant "no Blackfin-owned field is stored on a Side A (disk) object." So the
boundary is expressed one level up, as a **relation**: the taxonomy's `extensionId: null`
becomes *"no matching `IExtensionRecord`"*, resolved by `reconcile()` (§8). The seed is the
same; it just never lands as a mutable column on the disk row. (This is distinct from the
explicit `disable` edit of §11: disable changes the user's *config file* — a capability
operation the user asked for — it does not stamp a Blackfin field onto the model.)

## 6. Side B — Blackfin data, assembled

```ts
/** Stable under rename, move and hand-edit. NEVER contains a line index. */
export interface IExtensionAnchor {
  readonly scope: CapabilityScope
  readonly agent: AgentId
  readonly kind: CapabilityKind
  readonly logicalName: string
  /** The hash AT INSTALL TIME. Different from the current hash ⇒ hand-edited. */
  readonly contentHashAtInstall: string
  /** project/worktree scope: gitDir, NOT repositoryId (which mutates — D5). */
  readonly gitDir: string | null
  /** A resolution HINT only. Never the key. */
  readonly lastKnownPath: string
}

export interface IExtensionRecord {
  readonly id: string
  readonly anchor: IExtensionAnchor
  readonly source: ExtensionSource // [blackfin]
  readonly sourceRef: string | null // [blackfin] URL, git remote, marketplace id
  readonly installedVersion: string | null // [blackfin]
  readonly pinnedVersion: string | null // [blackfin]
  readonly installedAt: number // [blackfin]
  /** The only state that is pure Blackfin data. See §11 / D4. */
  readonly disabled: boolean // [blackfin]
  /** Trust: DEFINED in rfc-trust (#12). Here we only reserve the slot. */
  readonly trust: unknown // [blackfin]
  // NEVER: tokens, secrets, credentials, env values. No exception.
}
```

## 7. The boundary, materialised — and the correlation key

### 7.1 The invariant, verifiable field by field

> **No field of Side A is written by Blackfin, and no field of Side B is derived from
> disk.**

This is Acceptance Criterion 4, and it is checkable by reading the two interfaces above:
every `IDetectedCapability` field is a fact readable from the filesystem alone; every
`IExtensionRecord` field is a decision only Blackfin can have made (it installed it, pinned
it, disabled it). No field appears on both sides. The one field that *looks* like it should
bridge them — `extensionId` — is deliberately **not** a field on either row; it is the
*relation* the reconciler computes (§5.6).

| | Side A — `IDetectedCapability` | Side B — `IExtensionRecord` | The view — `IReconciledCapability` |
|---|---|---|---|
| **Truth** | the filesystem | Blackfin's decisions | derived from both |
| **Lifecycle** | throwaway; rebuilt on every scan | real; survives scans, survives repo removal | recomputed in memory every read |
| **Store** | cache (`WorkspaceDatabase` or successor); `pruneTo` may delete it | a **separate** Dexie database; **never** pruned | **never persisted anywhere** |
| **Written by** | the scanner only | install / disable / pin only | nobody — it is a return value |

"A lost cache is rebuilt; installation data is **not** cache." Side A can be dropped at any
moment with no loss (`workspace-database.ts:5-13` doctrine). Side B cannot: it is the record
of what the user did, and losing it loses real information.

### 7.2 The correlation key (the anchor)

The two sides are united by an **anchor**, following literally the doctrine the product
already applies to diff annotations (never a line index — always content + context;
`docs/BRIEFING.md` §5, `text-diff-expansion.ts`):

```
anchor = scope + agent + kind + logicalName + contentHashAtInstall
         (+ gitDir for project/worktree scope; lastKnownPath as a hint only)
```

Why each part, and why **not** `repositoryId + relativePath` (which today's cache uses,
`workspace-database.ts:29`):

- **`relativePath` is a hint, never the key.** The user moves a skill from
  `~/.claude/skills/` to `.agents/skills/` and a path-keyed record becomes silent orphaned
  junk. The path survives as `lastKnownPath` for fast resolution, but resolution falls
  through to content when it fails.
- **`repositoryId` is not stable and is not in the anchor.** Removing and re-adding a
  repository assigns a **new** `repositoryId`; switching worktree mutates the row's `path`
  (`repositories-store.ts` ~`:524`). A key built on `repositoryId + path` breaks under both.
  For project/worktree scope the anchor uses **`gitDir`**, the stable git anchor (D5).
- **`contentHashAtInstall` is what makes "you hand-edited this" sayable.** It is the hash at
  the moment of install; comparing it to the *current* `contentHash` is exactly the
  `locallyModified` signal (sentence #2, §10).

**Resolution order** during reconciliation, for each record: try `lastKnownPath`; if that
fails or the hash disagrees, try `contentHash`; if that fails, try `logicalName` (within the
same scope + agent + kind); if all fail, the record is reported as an **orphan** — visible,
never silently deleted (D9).

## 8. Reconciliation and the four divergence cases

Reconciliation is a **pure function, no I/O** — which is exactly where this codebase already
concentrates its complexity and its ~90 tests (`catalog.ts`, `parse.ts`). It runs after
every scan and produces a **view** that unites the two sides without ever writing one into
the other. Divergences become explicit *outcomes*, the same way `CleanupOutcome`
(`cleanup.ts:22-33`) makes deletion failures explicit results rather than exceptions.

```ts
// ─────────────────────────────────────────────────────────────
// THE VIEW — what the UI reads. Computed. NEVER persisted.
// ─────────────────────────────────────────────────────────────

export type ExtensionRelation =
  | { readonly kind: 'inherited'; readonly from: CapabilityScope }
  | { readonly kind: 'overridden'; readonly by: CapabilityScope }
  | { readonly kind: 'none' }

export interface IReconciledCapability {
  readonly detected: IDetectedCapability | null // null ⇒ orphan record (D9)
  readonly record: IExtensionRecord | null // null ⇒ source: 'detected'
  readonly state: ExtensionState
  readonly relation: ExtensionRelation
  /** true ⇒ current contentHash ≠ contentHashAtInstall. See #29. */
  readonly locallyModified: boolean
}

/**
 * PURE, no I/O — this is where the complexity lives, therefore where the tests
 * live. Follows the doctrine already set by catalog.ts and parse.ts. Determin-
 * istic; touches neither disk nor network.
 */
export function reconcile(
  detected: ReadonlyArray<IDetectedCapability>,
  records: ReadonlyArray<IExtensionRecord>
): ReadonlyArray<IReconciledCapability>
```

`IReconciledCapability` is **never persisted.** Writing it would fuse the two sides — the
failure mode of Option A (§9) — and code review must reject it. It is a return value, held
in memory, handed to the UI, and discarded.

### The four divergence cases (normative behaviour)

| Case | Detected | Record | Normative behaviour |
|---|---|---|---|
| **record without file** | no | yes | **Orphan.** `detected: null`. Reported as orphaned, **never deleted** (D9). The file the user installed is gone (deleted, or moved beyond resolution); the record is kept and shown as orphaned, because "never delete irreversibly by default" applies to Blackfin's own metadata too. |
| **file without record** | yes | no | **Detected.** `record: null`, `state: enabled`, `source: 'detected'` by construction. This is most of the real world (`.cursorrules`, a hand-written `CLAUDE.md`). Blackfin says, honestly, "I did not install this and I do not know where it came from." |
| **hand-edited file under a record** | yes | yes, hash differs | **`locallyModified: true`.** The current `contentHash` ≠ `anchor.contentHashAtInstall`. The record stays anchored; an *update* must **warn before overwriting** the user's edits (sentence #2). The edit is never undone by Blackfin. |
| **moved file** | yes (new path) | yes (old `lastKnownPath`) | **Re-anchored, not duplicated.** `lastKnownPath` misses; resolution falls to `contentHash`, which matches; the record is re-anchored to the new path (its `lastKnownPath` hint updated) and **not** duplicated into a second record. |

## 9. Options considered

#### Option A — one object, disk fields and Blackfin fields side by side

Extend `IContextFile` (`workspace-inventory.ts:95-114`) with `source`, `state`, `version`,
`enabled`. One object, one table, one screen.

- **For:** smallest possible change; #21 becomes trivial; the UI reads one object.
- **Against:** **violates the rule the user insisted on making explicit.** An object mixing
  `relativePath` (disk) and `enabled` (Blackfin) has two sources of truth and no authority.
  When the scan runs and the file is gone, what happens to `enabled`? If the object is rebuilt
  from disk on every scan (which is what `scan.ts` does today), `enabled` is lost; if it is
  preserved, the cache stopped being a cache and became a database — and `pruneTo`
  (`workspace-database.ts:73-85`) deletes real data when the user removes a repository. The
  rule "new caches get their own database" exists precisely to prevent this.
- **Verdict:** rejected. It is the failure mode the boundary names.

#### Option B — two fully separate models, no linking key

`IContextFile` (disk, throwaway cache) and `IExtensionRecord` (Blackfin, real) live in
different databases and **do not know about each other**. The UI joins by path at render time.

- **For:** perfect, trivially auditable boundary. The cache stays a cache.
- **Against:** the path-join **breaks the moment the path changes.** Move the skill and the
  install record becomes silent orphaned junk. Without a stable key, "you hand-edited this
  since you installed it" is impossible to say.
- **Verdict:** the boundary is right; the key is missing.

#### Option C — two separate models + an explicit correlation key, resolved at scan time

Like B, plus `IExtensionAnchor` (a stable identity) and a **reconciliation** step — pure, no
I/O, testable — that runs after each scan and produces a **view** uniting the two sides,
without ever writing one into the other.

```
  scan (I/O, never throws)  ──▶  IDetectedCapability[]   (disk truth, cache)
                                        │
  BlackfinDB (real data)   ──▶  IExtensionRecord[]       (installs, pins, disable)
                                        │
                            reconcile(…)   ← PURE, no I/O
                                        ▼
                              IReconciledCapability[]     (what the UI reads; never persisted)
```

- **For:** keeps the boundary intact *and* enables the UI's claims. The view is derived and
  never persisted, which makes it structurally impossible to write Blackfin state into the
  cache. Reconciliation is a pure function — exactly where this codebase concentrates its
  complexity and tests. Divergences become explicit outcomes, like `CleanupOutcome`.
- **Against:** three types where there was one. Real cost: the reconciliation function and
  its case matrix.
- **Verdict:** **recommended.**

#### Option D — the filesystem is the only truth; Blackfin writes its state to the user's disk

No database. Disable a skill = move it to `.disabled/`. Install = write a `.blackfin.json`
beside the item.

- **For:** one truth, always consistent; survives `git clone`; versionable; shareable.
- **Against:** **Blackfin starts writing to the user's files** — the one thing it promises not
  to do. It also does not even solve the problem: a `.blackfin.json` in the repo is *itself* a
  file another agent can read.
- **Verdict:** rejected — with one caveat this RFC records: for **project scope**, there may
  one day be a policy file *versioned and explicitly created by the user*. That is #42 / #53,
  it is opt-in, and it is not this model.

### Recommendation

**Option C.** The five dimensions, with the boundary marked in each, are §5's table.

## 10. The user-facing test (from the issue's "Experiência do usuário")

The model is invisible, but it fixes what the UI can say without lying. Each sentence is a
test the model must satisfy:

1. **"This skill is disabled in the project, but enabled globally."** — requires `scope` +
   `state` as separate axes, and a `disabled` state that is scoped and truthful.
   Satisfied: §5.2 (`scope`) + §5.4 (`state.disabled`, a disk fact per RATIFIED D4 — the
   explicit disable edited the project config, so it is genuinely disabled there and read back
   from disk, not a badge over a file the agent still loads).
2. **"You hand-edited this file since you installed it. Updating would overwrite your
   changes."** — requires the anchor + a content hash captured at install.
   Satisfied: §6 (`contentHashAtInstall`) + §7.2 + §8 (`locallyModified`).
3. **"This rule comes from `~/.claude/CLAUDE.md`. It applies here and you cannot see it from
   inside this project."** — requires `inherited`. Satisfied: §5.2 (computed relation).
4. **"This item was detected on your disk. Blackfin did not install it and does not know
   where it came from."** — requires `source: 'detected'` and the honesty of saying "I don't
   know." Satisfied: §5.3 (detected = absence of a record).
5. **"This plugin is broken: it points at a `SKILL.md` that does not exist."** — `broken` is a
   disk fact, computed, never stored as an opinion. Satisfied: §5.4 (`broken` computed from
   `IContextReference.exists`).

And the negative promise the UI must be able to make: **"Blackfin wrote nothing to your
files."** Any field that makes this sentence false is rejected in review of this RFC (§11).

## 11. The write boundary: no *silent* write; disable is an explicit, reversible edit

**RATIFIED (D4): "disable" edits the user's config.** Blackfin never writes a detected file as
a *side effect* of its own bookkeeping — but an explicit, user-initiated **disable** *does*
change what is on disk, because that is the only thing that actually disables a capability:
the agents read the disk, not Blackfin's database, so a record-only "disabled" badge over a
skill the agent still loads would be a lie. The maintainer ruled that the honest feature wins
over the never-touch-a-file absolute.

So the boundary is reframed from "Blackfin writes nothing" to **"Blackfin writes nothing
silently"**:

- **Disable performs the agent's own disable mechanism** — moving the capability aside (e.g.
  into an inactive directory) or editing that agent's config — done **transparently** (the
  user asked for it and sees exactly what changed) and **reversibly** (enable puts it back).
- **`disabled` is therefore a disk fact, not a Blackfin opinion** (§5.4): after the edit,
  Blackfin *reads back* the disabled state from disk on the next scan, exactly like `broken`.
  It can never be a lie, because it is no longer stored as one.
- **The only writes to a detected file are the explicit capability operations the user asked
  for** — `disable` / `enable` / `remove`. Blackfin's own data (install provenance: `source`,
  `version`, `contentHashAtInstall`) stays on Side B, in Blackfin's own database, and **never
  leaks into a user file.** That half of the boundary is unchanged and still enforced by the
  type (§7.1): no Side B field is ever written onto a detected file.

The still-forbidden thing is the failure mode the original invariant guarded against: a
`enabled: boolean` (or any Blackfin state) *persisted onto the object representing a user
file*, which is how "track a little state on disk" silently becomes "rewrite the user's file
behind their back." That remains impossible by construction — Side B is a separate store, and
`source: 'detected'` is not a storable value.

## 12. Database boundary (logical only; concrete schema is #14)

- `IDetectedCapability` → the **cache** (`WorkspaceDatabase` or its successor). It is
  throwaway; `pruneTo` (`workspace-database.ts:73-85`) may delete it; a lost cache is rebuilt.
- `IExtensionRecord` → a **separate, independent Dexie database.** It is **not** cache. It
  must **not** be pruned by `pruneTo`. It must **not** live beside data that is deleted when a
  repository is removed. It reuses `BaseDatabase.conditionalVersion`
  (`base-database.ts:23-37`), following the doctrine that already gave the cache its own
  standalone database (`workspace-database.ts:5-13`): a migration to support one must never put
  the other at risk.
- `IReconciledCapability` → **no store.** Computed in memory from cache + Blackfin DB on every
  read, and discarded. Persisting it is the fusion Option A commits.

The concrete Dexie schema, indexes, migrations and cache policy are **#14**. This section is
the logical boundary only.

## 13. Security

- **The boundary is a security control, not an architecture preference.** If Blackfin data can
  be written onto the object representing a user's file, the next step — in some PR, at some
  point — is writing the user's file. The type must make it impossible: the view is derived and
  never persisted, and `source: 'detected'` is not a storable value.
- **`IMcpServer` has no field for `env` values.** A property of the type, not a coding
  convention: a non-existent field cannot be filled, logged or serialised by mistake. MCP
  configs routinely contain tokens. `envKeys` holds **names**; presence/absence is #45's job to
  report as *configured* / *missing* / *inherited* / *stored externally*.
- **No token, secret or credential is persisted in any Blackfin database.** `IExtensionRecord`
  has no slot for one, and review of this RFC must reject any field that opens one.
- **`source` is never inferred.** A file that appeared on disk is `detected`, full stop.
- **The anchor is never an index.** Same doctrine the product already imposes on diff
  annotations (never a line index — `docs/BRIEFING.md` §5). A bad anchor would make Blackfin say
  "you did not edit this" about an edited file — or worse, offer to remove the wrong item.
- **Orphan records are shown, never silently deleted** (D9).
- **`disabled` cannot be a lie** (§11, RATIFIED D4). It is a disk fact Blackfin reads back after
  the explicit disable edit, not a Blackfin opinion stored over a file the agent still loads.
  The writes to detected files are only the explicit `disable`/`enable`/`remove` the user asked
  for — shown and reversible — never a silent side effect of Blackfin's bookkeeping.

## 14. Decision register

| # | Decision | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| D1 | Adopt Option C (two models + anchor + pure reconciliation)? | **Yes** | @matbrgz | everything |
| D2 | Fate of `ContextRole.Settings` and `ContextRole.Prompt`. | `Settings` **dissolves** (becomes the *container* of `mcp-server` items); `Prompt` **survives** as a kind. | eng | #21 |
| D3 | Exact anchor composition, incl. `logicalName` for an item with no frontmatter (`.cursorrules` has no `name`). | `scope + agent + kind + logicalName + contentHashAtInstall`, `relativePath`/`gitDir` as hints; `logicalName` = frontmatter `name` else basename. | eng | #35, #29 |
| D4 | **The most expensive: what does "disable" do?** | **RATIFIED: disable EDITS the config** — the agent's own disable mechanism (move the capability aside / edit its config), transparent + reversible. `disabled` becomes a disk fact (§11, §5.4). Record-only was rejected: the agents read the disk, so it would be a lie. | @matbrgz | #40, #31 |
| D5 | What does `worktree` scope anchor on, given `repositoryId` mutates (`repositories-store.ts` ~`:524`)? | **`gitDir` + worktree path**, never `repositoryId`. | eng | #55, #14 |
| D6 | Is `plugin` a `kind`? | **No** — a plugin is an Extension providing > 1 Capability (taxonomy §6.1). No `kind: 'plugin'`. | eng | #22 |
| D7 | Can an item have more than one `kind`? | **No** — `kind` is single; containment is a relation. | eng | #22 |
| D8 | Does the manifest require a real YAML parser, or extend `parseFrontmatter` (`parse.ts:29-69`) only where it hurts? | **Genuine fork.** A real parser is a new dependency in a 10-year-old codebase; the extend-only path keeps every manifest field nullable (§5.5). Recommendation: defer to #35/#43, keep all fields nullable regardless. | eng | #35, #43 |
| D9 | Orphan record (file gone): deleted, or kept and shown as orphan? | **Kept** — "never delete irreversibly by default" applies to Blackfin's own metadata too. | @matbrgz | #30 |

No decision may be left in `open` status at merge of the implementation issues; here they carry
recommendations awaiting ratification.

## 15. DECISÕES RATIFICADAS

The three genuine forks were ruled on by the maintainer. All three are now settled; #21/#35
implement against these answers.

- **(a) Scope inheritance — RATIFIED: computed relation** (§5.2). The `scope` enum stays
  `global | project | worktree`; `inherited`/`overridden` are computed between items, never
  stored — because `scope: 'inherited'` is an impossible state (inherited *from where?*), it
  would break the scanner's per-scope purity (`scan-global.ts:78`), and it matches the existing
  `broken`-is-computed precedent (`IContextReference.exists`, `:89-93`).
- **(b) Correlation-key (anchor) — RATIFIED:** `scope + agent + kind + logicalName +
  contentHashAtInstall`, with `relativePath` a hint and `gitDir` (never `repositoryId`) for
  project/worktree scope, resolving by path → hash → name → orphan (§7.2, D3, D5). For an item
  with no frontmatter (`.cursorrules`), **`logicalName` = the basename.**
- **(c) Disable — RATIFIED: it edits the config** (D4, §11). Disable performs the agent's own
  disable mechanism (move the capability aside / edit its config), transparently and reversibly;
  `disabled` becomes a disk fact Blackfin reads back. Record-only was **rejected**: since agents
  read the disk, it would show "disabled" over a capability the agent still loads — a lie. The
  never-write invariant is relaxed to **never-write-*silently***: the only writes to a detected
  file are the explicit `disable`/`enable`/`remove` operations the user asked for, and Blackfin's
  own install data still never leaks into a user file (§11, §7.1).

## 16. Acceptance criteria (self-check)

- [x] Document exists at `docs/superpowers/rfcs/2026-07-12-extension-model.md`.
- [x] Five dimensions defined with complete TypeScript types; every field marked
      **[disk]** / **[blackfin]** / **[computed]** (§5, §6).
- [x] A table/diagram shows the boundary: throwaway cache vs. real Blackfin data vs. derived
      never-persisted view (§7.1, §8, §12).
- [x] "No Side A field is written by Blackfin, and no Side B field is derived from disk" is
      stated and verifiable field by field (§7.1).
- [x] The anchor is specified, with the four divergence cases resolved (§7.2, §8).
- [x] Fate of `ContextRole.Settings` and `ContextRole.Prompt` decided and recorded (D2, §5.1).
- [x] `CapabilityScope.Worktree` defined, with its anchor, explaining why `repositoryId` does
      not serve (D5, §5.2, §7.2).
- [x] `inherited` / `overridden` defined as computed relations, with the computation rule and
      the reason they are not scope members (§5.2).
- [x] An MCP-server type exists with **no field able to hold an env value**, commented in the
      appendix (§5.5).
- [x] **D4 addressed:** what "disable" does, and what the UI must say about it (§11, §15c).
- [x] Decisions D1–D9 in a table with owner and recommendation; genuine forks flagged (§14, §15).
- [x] `reconcile()` signature published, pure and I/O-free, with its case matrix (§8, §17).
- [x] #12, #14, #21 and #35 can be written from this document without open questions (beyond the
      three ratification forks in §15).

## 17. The reconciliation matrix (what #21 must pass)

An RFC adds no production code. What it delivers is the **reconciliation matrix** #21 will have
to pass — and it is the matrix, not the prose, that proves the model closes. Target file:
`app/test/unit/extension-reconcile-test.ts` (`node:test` + `tsx`), quality bar set by
`app/test/unit/workspace-catalog-test.ts`, `workspace-parse-test.ts`, `workspace-store-test.ts`.

| Detected | Record | Expected result |
|---|---|---|
| yes | no | `source: 'detected'`, `record: null`, `state: enabled`, `relation` computed |
| yes | yes, hash equal | `locallyModified: false`, `source` from the record |
| yes | yes, hash **differs** | `locallyModified: true` — **and an update must warn before overwriting** |
| yes (new path) | yes (old `lastKnownPath`) | resolved by hash; record **re-anchored, not duplicated** |
| **no** | yes | **orphan** record: reported, **never deleted** (D9) |
| yes, global | yes, global, and a same-`logicalName` item exists in the project | global: `relation: overridden by project`; project: `relation: none` |
| yes, global | — and **no** same-name item in the project | project sees `relation: inherited from global` |
| item with unresolved `references` | any | `state: broken` — **computed**, never stored |
| `source: 'detected'` | — | **never** renders `state: 'outdated'` (explicit negative assertion) |
| item with no manifest (`.cursorrules`) | — | all nullable, nothing breaks, nothing is invented |

Invariant assertions — real tests, not comments:

- No `IExtensionRecord` field appears in any object written to the cache database.
- No object returned by the scanner contains an environment-variable value.
- `IReconciledCapability` is never serialised to any database.
- `reconcile()` is deterministic and touches neither disk nor network.

## 18. Out of scope

- **Trust, permissions, cryptographic provenance, signatures.** That is #12. This RFC defines
  *where* a trust decision would be stored (`IExtensionRecord.trust`), not what it is.
- **Remote registry, distribution, version resolution.** That is #13.
- **The concrete Dexie schema, migrations, cache policy.** That is #14.
- **The `ContextRole` → `CapabilityKind` migration in code.** That is #21. This RFC produces the
  target type; it does not touch `catalog.ts` or `workspace-inventory.ts`.
- **Any UI.** That is #26.
- **Executing, testing or connecting to any extension or MCP server.** Blackfin does not host
  agents.
- **Inventing a proprietary manifest format and asking the ecosystem to adopt it.**

## 19. Files cited (read, not modified — the change is #21)

- `app/src/models/workspace-inventory.ts` — `ContextRole:32-47`, `ContextScope:71-76`,
  `IContextFile:95-114`, `IContextReference:89-93`, `IRepositoryInventory:148-156`,
  `IGlobalContext:213-218`.
- `app/src/lib/databases/workspace-database.ts:5-13` (cache doctrine), `:28-30` (schema),
  `:73-85` (`pruneTo`).
- `app/src/lib/databases/base-database.ts:23-37` — `conditionalVersion`.
- `app/src/lib/stores/workspace-store.ts:61-68` — global context in memory only.
- `app/src/lib/workspace/parse.ts:29-69` — `parseFrontmatter`; not a YAML parser (D8).
- `app/src/lib/workspace/catalog.ts:177-183` — `SettingsFiles` incl. `'mcp.json'`: container
  classified, content ignored.
- `app/src/lib/workspace/cleanup.ts:22-33` — `CleanupOutcome`: failure as result, not exception.
- `app/src/lib/workspace/scan-global.ts:78` — the scanner never throws.
- `app/src/lib/git/worktree.ts` — `gitDir` is the stable anchor; `app/src/lib/stores/repositories-store.ts`
  `switchWorktree` (~`:524`) mutates `path`.
- `docs/superpowers/rfcs/2026-07-12-taxonomy.md` — the ratified Option C this document builds on.
- `docs/BRIEFING.md` §5 — worktrees are not separate `Repository` rows; anchors are never line indices.
