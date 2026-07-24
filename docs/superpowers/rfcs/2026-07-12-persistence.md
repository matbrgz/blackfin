# RFC — Filesystem truth, Blackfin metadata, and cache: a persistence contract

- **Date:** 2026-07-12
- **Issue:** [#14](https://github.com/matbrgz/blackfin/issues/14) — *RFC: Filesystem truth, Blackfin metadata, and cache — a persistence contract*
- **Status:** Proposal. Awaiting maintainer ratification of **D1** (three tiers, one database per durability) and **D3** (`gitDir` as the tier-2 anchor, and what becomes of the shipped `repositoryId` column). See §12.
- **Depends on:** [#11](https://github.com/matbrgz/blackfin/issues/11) — *extension domain model* (**RATIFIED**). #11 decides *what* the data is; this decides *where it lives and what may destroy it*. Where the two touch, #11 wins.
- **Blocks:** nothing outright — it is a contract that #35, #55, #58, #68 and every future store must obey. Two of them (`ExtensionRegistryDatabase`, `WorktreesDatabase`) already obey it and were written before it existed.
- **Scope of this document:** the three tiers and the boundary between them, the database rule, the key rule, reconciliation, the migration policy, and the secrets invariant. **No production code. No concrete schema** — those are #35 (installations), #55 (checkpoints), #68 (annotations).

---

## 1. Problem

The product's hardest promise is a negative one:

> **Configuration detected on the filesystem and data managed by Blackfin never mix.**

Today that promise holds by accident, because **there is barely any Blackfin data
to mix in**. The inventory is 100% derived from disk (`scan.ts`, `scan-global.ts`),
`WorkspaceDatabase` is an explicitly disposable cache, and until #35 nothing was
installed, enabled, disabled or annotated.

That has started to change, and it changed *without a written contract*. Two
databases of Blackfin's own data now exist in `main` — `ExtensionRegistryDatabase`
(#35) and `WorktreesDatabase` (#55) — and each one argues the doctrine in its own
header, in its own words, having arrived at it independently:

> *"That database is a cache — it has a `pruneTo()` and its own comment says
> losing it is fine, because a scan rebuilds it. This one is the opposite: losing
> the row that says 'I wrote these five files' turns a managed item into orphaned
> junk nobody can safely remove. There is NO automatic pruning here, by design.
> Separate durabilities, separate databases (#14)."*
> — `extension-registry-database.ts:11-20`

> "this metadata must **survive** the `Repository` row mutating underneath it on
> a worktree switch, so it cannot live in the same database as that row."
> — `worktrees-database.ts:6-15`

Two authors, two features, the same conclusion, and a forward reference to a
document that was never written. This is that document. Its job is not to invent
a rule — it is to **write down the rule the code already found**, so the third
feature does not have to rediscover it and the fourth does not get it wrong.

The way software of this shape fails is specific and always the same: an
`enabled: boolean` on the object that represents a *user's file*. From there,
Blackfin either rewrites the user's file to persist its own state, or it lies
about what is on disk. #11 already ruled that particular case (D4: disable is an
explicit, visible edit of the agent's own config, read back from disk). This RFC
generalises it.

## 2. Why it matters

The cost of getting this wrong is not rework of code. It is **rework of data
already on the user's machine**, and some of it is not recoverable by rescanning:

- `pruneTo()` (`workspace-database.ts:73-85`) is correct for a cache and
  catastrophic for install records. It deletes rows for repositories the user no
  longer has. If a trust decision or an installation record ever shares a
  database with cache, that function is one join away from erasing it.
- A repository the user removed and re-added is a **new `repositoryId`**. Every
  tier-2 row keyed on the old one is silently orphaned — not corrupted, not
  errored: invisible.
- Losing "I wrote these five files" does not degrade a feature. It converts a
  managed extension into junk that nobody, including Blackfin, can safely remove
  — which is exactly the state #25 exists to report and #30 exists to fix.

And there is a promise on the other side that is just as load-bearing: the screen
paints full, immediately, from cache (`workspace-store.ts:92-100`) while a rescan
fills in behind it. A context app that opens on a spinner has lost. Any tier
boundary drawn here must keep that.

## 3. Current state (grounding)

**Seven concrete Dexie databases**, all extending `BaseDatabase`
(`base-database.ts:23-37`, whose `conditionalVersion` is the shipped mechanism
for schema versioning):

| Database | What it holds | Tier, as built |
|---|---|---|
| `RepositoriesDatabase` | the user's repositories, owners, GitHub metadata | **real** (upstream's; tracked against it) |
| `ExtensionRegistryDatabase` | installations + append-only events (#35) | **Blackfin data** — no pruning, by design |
| `WorktreesDatabase` | worktree metadata (#55) | **Blackfin data** |
| `WorkspaceDatabase` | the inventory, one serialised blob per repository | **cache** — has `pruneTo()` |
| `IssuesDatabase` | GitHub issues | cache |
| `PullRequestDatabase` | pull requests and their refs | cache |
| `GitHubUserDatabase` | mentionable users, avatars | cache |

**`WorkspaceDatabase`** — `conditionalVersion(1, { inventories: '++id, &repositoryId' })`
(`:28-30`), the whole inventory serialised into one opaque column (`:15-20`). Its
header already states the doctrine for tier 3: *"a cache that is lost is a cache
that is rebuilt"*, in a **standalone** database because *"a schema migration
there to support a cache would put real data at risk to speed up a screen."*

**`ExtensionRegistryDatabase`** — `installations: 'installId, &rootPath, ownership, kind, agent, [scope+repositoryId]'`
plus an append-only `events` table (`:33-37`). `installId` is Blackfin-generated
and stable across a folder move; `&rootPath` is unique so that two rows pointing
at one root is an error rather than silent corruption.

**Not persisted at all:** the global context. It lives in memory
(`workspace-store.ts:59`) and is rebuilt by `scanGlobalContext` on demand
(`:79`). This is correct under the tiers below — it is pure disk truth — but it
is worth naming, because "we simply do not store it" is a design position, not
an oversight.

**View state** lives in `localStorage`: `LastSelectedRepositoryIDKey`
(`app-store.ts:477`), `RecentRepositoriesKey` (`:486`), and a long tail of
preferences through `:633`. RFC #15 §8 adds the rail's destination and scope to
that tail, and explicitly rules them *out* of the tiers below.

**The anchor already exists.** `Repository.gitDir` is a real, persisted field
(`repositories-database.ts:61`, `repository.ts:75`), with a documented fallback
to `path/.git` (`repository.ts:97-101`). And `IExtensionAnchor` (`extension.ts:197-207`)
already declares the rule this RFC formalises:

> `/** project/worktree scope: gitDir, NOT repositoryId (which mutates — D5). */`

## 4. The three tiers (normative)

The boundary has to be checkable **field by field**, not by intention. The test
for any field is one question: **what is lost if this row is deleted right now?**

### Tier 1 — Filesystem

The truth about what the agents actually read. Blackfin **reads** it. It writes
only where the user told it to write, and only what the user asked it to write.

- **Owned by:** the user and their tools.
- **Persisted by Blackfin:** never. It is re-derivable by definition.
- **Deleting it costs:** the user's actual configuration. Blackfin must not be
  able to do this except through an explicit, reviewed act (`cleanup.ts:64-152`
  is the standard of care: path containment, refuses to follow symlinks,
  reclassifies at the moment of deletion, trash rather than `rm -rf`).

### Tier 2 — Blackfin metadata

What Blackfin owns and **nobody can derive from anything else**: installations,
trust decisions, pins, checkpoints, annotations, attribution.

- **Owned by:** Blackfin.
- **Real data. Never pruned. Never in a cache database. Always migrated.**
- **Deleting it costs:** a fact that cannot be recovered by looking harder at the
  disk. That is the whole definition of the tier.

**The membership test, applied to the awkward cases:**

| Field | Tier | Why |
|---|---|---|
| `installedAt`, `sourceRef`, `pinnedVersion` | 2 | No amount of scanning recovers where a file came from |
| `trust` (#12) | 2 | A decision, not an observation |
| `disabled` | **1** | RATIFIED #11 D4 — disabling edits the agent's own config; Blackfin reads the fact back. A stored `disabled` would be a value that can disagree with reality, which is the definition of a lie |
| `locallyModified` | **computed** | `currentHash ≠ contentHashAtInstall` — one side is tier 1, one is tier 2, and the answer is stored in neither |
| `contentHashAtInstall` | 2 | A fact about the past. The disk has only the present |
| Inventory (`IContextFile`) | **3** | A cached observation of tier 1 |

### Tier 3 — Cache

Disposable, rebuildable, of no value in itself. Deleting it costs a scan or a
download — never a datum.

- **Owned by:** nobody. It is a performance artifact.
- **May be pruned, dropped wholesale on upgrade, and deleted by the user at will.**

## 5. The database rule — D1

> **One database per durability. A tier-2 store never shares a Dexie database
> with a tier-3 store.**

Not one table per tier inside a shared database — a **separate database**, which
is what `ExtensionRegistryDatabase` and `WorktreesDatabase` already do. The
reason is not tidiness, and it is worth stating in full because "just add a
table" will be proposed again:

1. **`pruneTo()` is in scope of whatever database it lives in.** A cache needs
   pruning; tier 2 must never be pruned. Two policies cannot coexist safely
   behind one connection, and the enforcement of "do not prune this table" would
   be a code review, forever.
2. **Migration policy differs by tier** (§8) — a cache is *discarded*, tier 2 is
   *migrated*. Dexie's version number is per-database, so one shared database
   forces both tiers through the same upgrade, and a botched cache migration
   takes real data with it. `WorkspaceDatabase`'s own header made this argument
   about `RepositoriesDatabase` before any of this existed.
3. **Upstream tracks `RepositoriesDatabase`.** Bumping its schema version risks a
   rebase conflict and — worse — a version-number collision if upstream bumps
   too (`worktrees-database.ts:8-12`). Every Blackfin store stays out of it.

**Consequence, stated plainly so it is not a surprise:** Blackfin will accumulate
several small databases rather than one large one. That is the intended shape.
The alternative is one database whose safest operation is unavailable to half its
tables.

## 6. The key rule — D3

> **Tier 2 is keyed on facts that survive the user's UI actions. `repositoryId`
> is not one of them.**

`repositoryId` is an autoincrement row id in `RepositoriesDatabase`. Remove a
repository from the list and add it back and it is a **different number** for the
same directory. Anything tier-2 keyed on it is silently orphaned — no error, no
corruption, just rows nobody will ever look up again. `IExtensionAnchor` already
says this in code (`extension.ts:203`).

**The anchor is `gitDir`** (`repository.ts:97-101`), because it identifies the
repository the way git does, survives the row being recreated, and distinguishes
a worktree from its parent — which `path` does not, and which M4 needs.

### 6.1 Index versus identity — and the shipped column

The shipped registry stores `repositoryId: number | null` on `IInstallation`
(`extension-registry.ts:66`) and indexes `[scope+repositoryId]`. Read against the
rule above, that looks like a contradiction, and this RFC has to say which it is
rather than leave it for someone to discover.

**It is a permitted index, not an identity — under two conditions:**

1. **Nothing resolves an installation by `repositoryId` alone.** It accelerates
   "show me this repository's installations" for a repository that is in the list
   right now. Identity is `installId`, correlation is the anchor.
2. **A stale value is treated as unknown, never as a match.** After a
   remove-and-re-add, rows carry an id that now belongs to a different repository
   or to none. The lookup must be by `gitDir` with `repositoryId` as a cache of
   that resolution, refreshed on load — not the other way around.

If either condition cannot be met, the column should be dropped rather than
defended: an index that can point at the wrong repository is worse than no index.
**This is D3, and it is the one decision here with a shipped consumer.**

## 7. Reconciliation — the four cases

Disk and metadata *will* disagree. #11 §8 already ruled the resolution order
(path+hash → hash → path → logicalName) and `reconcile()` implements it. This RFC
adds only what each divergence means for *persistence*:

| Case | Meaning | What persistence does |
|---|---|---|
| **Orphaned record** — record, no file | The file was deleted outside Blackfin | **Keep the record. Report it (#25). Never auto-delete** — deleting is how the user loses the only evidence of what was installed |
| **Unregistered file** — file, no record | Detected, not installed | Nothing. `detected` is the *absence* of a record (#11 §5.3), not a row to write |
| **Hand-edited** — hashes differ | The user edited what Blackfin wrote | Nothing is written. `locallyModified` is computed at read time and surfaced (#29) |
| **Moved** — same hash, new path | The user reorganised | Update `lastKnownPath` — a **hint**, never the key (`extension.ts:206`) |

The unifying rule: **reconciliation never resolves a disagreement by writing to
tier 1.** It reports, or it updates a hint. If a feature needs more than that, it
needs the user (#11 D4).

## 8. Migration policy

| Tier | On a schema change | Why |
|---|---|---|
| 3 (cache) | **Discard.** Always. `conditionalVersion(n, …)` with an upgrade that empties the store | Migrating a cache is unpaid work with a real downside: a migration bug in throwaway data still throws, and now the app fails to open over data nobody needed |
| 2 (Blackfin) | **Migrate.** Always. Never a discard, never a "rebuild on next launch" | There is nothing to rebuild from. That is the tier's definition |
| 1 (filesystem) | n/a | Not persisted by Blackfin |

`WorkspaceDatabase` is already shaped for the discard: the inventory is one
opaque column (`:15-20`), so an upgrade never has to understand its contents. It
is at v1 and needs no migration today — the extension model landed *beside* it
(#21) rather than inside it.

## 9. Secrets — a type invariant

The rule is not "do not log tokens". It is that **there is no field to put one
in**, which is a property a review cannot forget to check. `IMcpServer`
(`extension.ts:133-142`) already implements it:

```ts
/** Only the NAMES of the variables. Never the values. See #45. */
readonly envKeys: ReadonlyArray<string>
```

Normative, for every store: **no tier-2 or tier-3 schema may declare a field
whose value is, or can contain, a credential.** A settings file that carries a
token is read, the *names* are extracted, and the values are never returned by
the reader — not "returned and discarded". #45 reports each key as configured /
absent / inherited / externally-stored, all of which are statements about a name.

Corollary: the user-facing promise *"Blackfin does not keep any of your tokens.
Not even your MCP's. It does not even know what it is"* is true by construction,
and is the only kind of security claim #12 permits — a structural one.

## 10. Repository removed, moved, re-cloned, worktree switched

The four events that break naive keying, and what each must do:

| Event | `repositoryId` | `gitDir` | Tier 2 |
|---|---|---|---|
| Removed from the list | freed | unchanged on disk | **Kept.** Re-adding the folder restores the connection through `gitDir` |
| Re-added | **new** | unchanged | Re-resolved by `gitDir`; any cached `repositoryId` refreshed (§6.1) |
| Folder moved | unchanged | **changes** | Resolved by `installId` + content; `gitDir` and `lastKnownPath` updated |
| Re-cloned elsewhere | new | new | A **different** repository. Rows are not transplanted, and nothing pretends otherwise |
| Worktree switched | row mutates | worktree's own | Must survive it — the structural reason `WorktreesDatabase` is separate (`worktrees-database.ts:13-15`) |

The promise this table exists to keep: *"You removed this project from the list a
month ago and added it back. Your annotations and installations are still here."*

## 11. Options considered

### Option A — One database, a table per concern

`conditionalVersion(2, …)` on `WorkspaceDatabase` and move on.

- **For:** one connection, one migration, least code.
- **Against:** fuses tier 2 with tier 3 in one IndexedDB file. `pruneTo()` becomes
  a join away from install records, and one Dexie version number governs both a
  discard policy and a migrate policy. This is the option the two shipped
  databases each rejected, in writing.

### Option B — One database, tiers separated by a naming convention

`cache_*` and `data_*` tables, discipline enforced by review.

- **For:** one connection; the boundary is at least visible.
- **Against:** a convention is not an invariant. The failure is silent and the
  data is the user's.

### Option C — One database per durability (what §5 describes)

- **For:** the dangerous operation is *structurally unavailable* to the tier that
  must not suffer it. Matches what already ships. Upstream's `RepositoriesDatabase`
  stays untouched, so rebases stay cheap.
- **Against:** several small databases; a cross-tier read is two queries and a
  join in memory. Real, and cheap at this size — an inventory is per repository
  and a registry is per install.

### Recommendation

**Option C.** It is also the option with two independent implementations already
in `main`, which is the strongest evidence available that it is the one that
survives contact with a feature.

## 12. Decision register

| # | Decision | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| D1 | Three tiers; one database per durability; tier 2 never shares with tier 3 | **Adopt** (Option C) — already implemented twice | @matbrgz | #35, #55, #58, #68 |
| D2 | Tier 2 is never pruned automatically | **Adopt.** An orphan is reported (#25), never collected | @matbrgz | #25, #30 |
| D3 | `gitDir` is the tier-2 anchor; the shipped `repositoryId` column is an index under §6.1's two conditions, or it is dropped | **Adopt with the conditions**, and drop the column if they cannot be met | @matbrgz | #35 |
| D4 | Cache is **discarded** on schema change; tier 2 is **migrated**, always | **Adopt** | eng | every future store |
| D5 | The global context stays unpersisted | **Adopt** — pure tier 1, rebuilt by a scan | eng | #22 |
| D6 | View state (rail destination, scope, expansion) is `localStorage`, not tier 2 | **Adopt** — RFC #15 §8. Losing it costs one click | eng | #140 |
| D7 | No schema may declare a field that holds a credential | **Adopt** — a type invariant, as `IMcpServer.envKeys` already is | @matbrgz | #43, #45 |
| D8 | A user-facing "clear cache" that provably cannot touch tier 2 | **Adopt** — the button is the proof of D1; if it cannot be written safely, D1 was not implemented | design + eng | #34 |

D1 and D3 are the maintainer's calls — D3 because it has a shipped consumer.
The rest follow, or are engineering calls recorded so they are not rediscovered.

## 13. The user-facing test

Persistence has no screen, but it has promises, and each is a sentence the user
could read:

- [ ] *"Clearing Blackfin's cache never loses anything of yours."* — and there is
      a button that does exactly that, and it is safe (D8)
- [ ] *"You removed this project a month ago and added it back. Your annotations
      and installations are still here."* — §10
- [ ] *"Blackfin has not written anything to your files. What you see is what is
      on disk."* — §7
- [ ] *"This file has changed since Blackfin installed it. Did you edit it?"* —
      computed, never stored (§4)
- [ ] *"Blackfin does not keep any of your tokens. Not even your MCP's."* — true
      by construction (§9)
- [ ] The screen still paints full and immediately from cache
      (`workspace-store.ts:92-100`) once tier 2 exists

## 14. Out of scope

- **Concrete schemas.** Installations are #35, checkpoints #55, annotations #68.
  This gives the contract they obey, not their tables.
- **The domain model.** That is #11 (RATIFIED). Here it is only where it lives.
- **Trust and provenance.** That is #12. Here it is only guaranteed that a trust
  decision persists and is never pruned.
- **Sync between machines, backup, export/import.** Blackfin metadata is local.
  #42 is a different thing and is opt-in.
- **Writing to the user's files to persist Blackfin state.** That is the boundary
  (#11 D4). A feature that needs it needs an explicit, visible decision — not a
  persistence shortcut.
- **Telemetry, analytics, any data leaving the machine.**
- **Replacing Dexie.** It is the codebase's convention; seven databases use it.

## 15. Files cited (read, not modified)

- `app/src/lib/databases/base-database.ts:23-37` — `conditionalVersion`
- `app/src/lib/databases/workspace-database.ts:5-13`, `:15-20`, `:28-30`, `:73-85` — the tier-3 doctrine, the opaque blob, v1, `pruneTo`
- `app/src/lib/databases/extension-registry-database.ts:11-20`, `:33-37` — the tier-2 doctrine, written before this RFC
- `app/src/lib/databases/worktrees-database.ts:6-15` — the same conclusion, reached independently
- `app/src/lib/databases/repositories-database.ts:61` — `gitDir`, persisted
- `app/src/models/repository.ts:75`, `:97-101` — `gitDir` and its fallback
- `app/src/models/extension.ts:133-142`, `:197-207` — `envKeys`, and the anchor's "NOT repositoryId"
- `app/src/models/extension-registry.ts:61-68` — `installId`, `repositoryId`, `rootPath`
- `app/src/lib/stores/workspace-store.ts:59`, `:79`, `:92-100` — the unpersisted global context, and painting from cache first
- `app/src/lib/stores/app-store.ts:477`, `:486-633` — the `localStorage` tail
- `app/src/lib/workspace/cleanup.ts:64-152` — the standard of care for touching tier 1
- `docs/superpowers/rfcs/2026-07-12-extension-model.md` §5.3, §5.4, §8, §11 — source, state, divergence, the write boundary
- `docs/superpowers/rfcs/2026-07-12-information-architecture.md` §8 — view state is not tier 2
