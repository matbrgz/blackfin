# RFC — Marketplace architecture: registry, distribution, versioning

- **Date:** 2026-07-12
- **Issue:** [#13](https://github.com/matbrgz/blackfin/issues/13) — *RFC: Marketplace architecture — registry, distribution, versioning*
- **Status:** **RATIFIED** by the maintainer. Adopted: **Option B (static Git index) as the spine + Option D (federation) added incrementally**; **Option C (own backend) rejected**; **Option A (Git/URL install only) recorded as the acceptable fallback if M3 is cut**. And **D5 ratified: Blackfin NEVER hosts bytes** — it only indexes/points; artifacts live at their origin (§13). M3 (#47–54) may proceed on these.
- **Depends on:** [#10](https://github.com/matbrgz/blackfin/issues/10) — *taxonomy* (**RATIFIED**, `docs/superpowers/rfcs/2026-07-12-taxonomy.md`) and [#11](https://github.com/matbrgz/blackfin/issues/11) — *extension domain model* (**RATIFIED**, `docs/superpowers/rfcs/2026-07-12-extension-model.md`). Without `Extension`, `source` and `IExtensionRecord`, the word "update" has no subject. Where this document and the two ratified RFCs touch, **the ratified RFCs win.**
- **Blocks:** #47 (registry client), #48 / #49 (marketplace UI), #52 (channels), #54 (publishing) — and, via #47, #51 (integrity).
- **Scope of this document:** the strategic decision (own registry or not), the shape of a catalog entry, the distribution mechanism, versioning and update semantics, and the security posture that follows. **No production code. No schema is created.** The concrete Dexie schema is #14; the trust/permission model is #12/#50; integrity, signatures and provenance mechanics are #51; the UI is #48/#49; publishing and curation are #54.

---

## 1. Problem

All of M3 — #47, #48, #49, #50, #51, #52, #53, #54 — presupposes that **a registry
exists**, that it **has a shape**, that items **have versions**, and that "update" **means
something**. None of that has been decided. Today the app makes **not a single network
request** related to extensions, has no registry client, no catalog cache, and **no notion
of version anywhere in the domain** — `IContextFile`
(`app/src/models/workspace-inventory.ts:95-114`) carries `byteLength`, `lineCount`,
`modifiedAt`, `name`, `description`, and nothing else: no `version`, no `source`, no
`author`. Grounded confirmation of the absence: a search of `app/src` for `marketplace` or
`registry` returns nothing, and there is no `app/src/lib/marketplace/` directory.

But there is a question **prior** to the architecture, and it is why this RFC is hard:

> **Does Blackfin need its OWN registry?**

The ecosystem already has marketplaces. Claude Code has one. There are community indexes of
MCP servers. `npx skills add` installs from Git repositories. Building an own registry means
hosting a service, curating content, moderating submissions, operating signing keys, and
answering for supply-chain security — all of it for a desktop app that, so far, **has no
backend at all** and whose founding argument is *observe and organise what already exists on
the user's machine* (`docs/BRIEFING.md` §3).

A badly-designed marketplace is not a weak feature. It is a **permanent operational
liability** and a **new attack surface**, glued onto an app that today only reads the disk.

## 2. Why it matters

The marketplace is the single part of the backlog that drags Blackfin from "a local
application that reads your disk" toward "a client of a service that distributes executable
code." That crossing has consequences that do not reverse:

- **A server comes to exist.** Someone operates it, pays for it, and answers when it falls
  over or is compromised.
- **Transitive trust comes to exist.** The user trusts Blackfin; Blackfin would then attest
  things about third-party packages. If a malicious package is distributed through a
  marketplace bearing the Blackfin brand, the damage is to the brand — and #12 already
  established that Blackfin **cannot contain** what an extension does once installed. The
  badge would be issued by the party that cannot guarantee it.
- **Versioning comes to exist**, and therefore compatibility, and therefore a "this skill
  works on Claude Code 2.x but not on Cursor" matrix that someone has to maintain — for
  **fourteen** agents (`AgentId`, `workspace-inventory.ts:14-29`) that version in different
  ways, and not all of which version at all.

And there is a cheap path this RFC must take seriously before accepting any of those costs:
**build no registry, and install straight from Git/URL** (#38, #39, both in M2, both already
in the backlog). If M2 already ships install-from-Git, the question M3 has to answer
honestly is: *what does the registry add, beyond a search box?*

## 3. Current state (grounding)

**Nothing exists.** No client, no catalog cache, no version, no channel, no update. What
does exist, and determines what is cheap or expensive to build:

- **No notion of version in the domain.** `IContextFile`
  (`workspace-inventory.ts:95-114`) has no `version`, no `source`, no `author`. #11
  introduces `IExtensionRecord.installedVersion` and `pinnedVersion`; until an install
  record exists, "update" has no subject (#11 §5.4: a `detected` item can **never** be
  `outdated`).
- **No reusable network infrastructure for this.** The app talks to forges
  (`app/src/lib/api.ts`) — authenticated, GitHub/GitLab/Bitbucket-specific, coupled to
  `Account`. There is no generic, cached, retrying HTTP client for a public unauthenticated
  registry. And `docs/BRIEFING.md` §5 records that **exactly one GraphQL call exists in the
  whole codebase** (`api.ts:2855`), a POST in a template literal: no GraphQL client, no
  codegen, no typed schema. A GraphQL registry would be building that foundation from
  scratch, for this (see **D9**).
- **The cache doctrine is already established and reusable.** `WorkspaceDatabase`
  (`app/src/lib/databases/workspace-database.ts:5-13`) is a **standalone** Dexie database,
  and its header states the rule verbatim: *"A cache that is lost is a cache that is
  rebuilt"*; a separate database precisely so that migrating the schema of real data to
  accommodate a cache never puts real data at risk. A marketplace catalog is **exactly
  that** — a throwaway remote cache — and therefore earns **its own database**, following
  the rule (#14).
- **`BaseDatabase.conditionalVersion`** (`app/src/lib/databases/base-database.ts:23-37`) is
  the schema-versioning mechanism any new database reuses.
- **Writing to disk safely already has a pattern.** `cleanup.ts:55-123` (`checkDeletable`):
  path containment, symlink refusal (`:84`), reclassification at the instant of the act,
  trash, failure as a *result* (`CleanupOutcome`, `:22-33`). A marketplace installer must
  match that rigour — it *writes*, and writing is more dangerous than deleting a cache.
- **Blackfin does not execute extensions** (#12, ratified taxonomy §9). The marketplace
  distributes files that **the agent** will read. That limits what a registry can promise,
  and it is the fact that most constrains this architecture.

## 4. Relationship to the ratified RFCs (#10, #11)

This RFC does not redefine anything the two ratified RFCs settled; it consumes their
vocabulary and writes only the distribution layer on top.

- **From #10 (taxonomy):** the unit a marketplace distributes is an **Extension** — the
  unit of distribution, trust and versioning. A skill installed via `npx skills add` is an
  Extension of a single Capability; a Claude Code plugin is an Extension whose manifest
  provides more than one Capability. A marketplace **never** sells a bare `mcp-server`
  Capability as an installable — it is a `requires` target, not a product (#10 §6.3). And
  #10 §8 already reserved this document's ground: *"Registry, distribution, versioning
  (#13). The marketplace, its catalog and update flows are out. `version` exists as a field
  so #13 has somewhere to write."* This is that somewhere.
- **From #11 (extension model):** the marketplace writes into `IExtensionRecord`, not into
  the disk cache. `source` (`marketplace | git | url`), `sourceRef`, `installedVersion`,
  `pinnedVersion` and `contentHashAtInstall` are the fields a completed install populates
  (#11 §6). The catalog cache this RFC introduces is **Side A-shaped** (throwaway, remote,
  rebuildable) but is a *different* cache from the inventory: it mirrors a remote index, not
  the local disk. The installed-extension record is **Side B** (#11 §7) and lives in a
  different, non-throwaway database. Losing the catalog cache costs a download; losing the
  install records loses real user data. **These two never share a database.**

## 5. The central question — options

The issue foregrounds one decision and everything else follows it. The floor against which
every option is measured is **#38/#39 (M2)**: install-from-Git already exists *before* any
marketplace. So each option must justify what it adds over "the user pastes a Git URL and
Blackfin installs it, records the origin, checks the hash, and shows it honestly."

### Option A — No registry: install from Git and URL, and that is all

M3 is cancelled as "a marketplace" and dissolves into the M2 that already exists (#38, #39).
Finding an extension is finding it on GitHub. Blackfin installs, records the origin, checks
the hash, and displays everything honestly.

- **For:** zero infrastructure, zero backend, zero curation, zero operational liability.
  Zero new attack surface. Coherent with the product — Blackfin **observes and organises**;
  it is not a store. And provenance gets *more* honest, not less: "came from
  `github.com/foo/bar@abc123`" is a stronger fact than "came from the marketplace," which is
  a fact about an intermediary.
- **Against:** there is no discovery. The user must already know what they want and where it
  is. No category, popularity, author, normalised changelog, or quality signal. The growth
  loop a marketplace gives is lost.
- **Cost of error:** ~zero. It is already in the M2 backlog. **If M3 is cut, this is what
  remains standing, and that is acceptable.**

### Option B — Registry as a static index (one file, versioned in Git, served by CDN)

The registry is a **static JSON**, maintained in a public Git repository and served by CDN.
Entries point at **where the bytes actually are** (a Git repository, a GitHub release).
Blackfin downloads the index, caches it in its own Dexie database, searches locally, and
installs from the pointed-at origin.

- **For:** discovery without a backend. No server, no database to operate, no uptime, no
  on-call. Moderation and submission are a Pull Request — auditable, public, with history
  and identified reviewers. Caching a JSON and searching it is exactly what
  `WorkspaceDatabase` already does with the inventory: a standalone, throwaway database
  (`workspace-database.ts:5-13`), the same doctrine reapplied. Scales for free via CDN.
  Works offline from the cache. **Blackfin hosts nobody's bytes** — so it never becomes the
  distribution vector for a malicious package.
- **Against:** the index grows and becomes a large download (mitigable: shards by
  category/agent, ETag, `If-None-Match`). No real popularity metrics (downloads do not pass
  through us). Curation-by-PR does not scale to thousands of submissions — but it scales
  **far** beyond where this product is.
- **Cost of error:** low. One repository, one JSON schema, an HTTP client with caching, one
  Dexie database. No backend. And it is additive — if Option C is ever needed, the static
  index becomes its first export.

### Option C — Registry as a service (own API, backend, database, accounts)

A real service: REST/GraphQL API, database, publisher accounts, download telemetry,
moderation, signing keys.

- **For:** everything a mature marketplace has — real popularity, fast moderation, immediate
  takedown, telemetry, self-service publishing.
- **Against:** Blackfin **has no backend.** This is a new product, with a permanent
  operational cost, on-call, moderation, and legal responsibility for hosting third-party
  code. If GraphQL, it is also building from scratch the infrastructure the codebase does
  not have (one GraphQL call exists today — `api.ts:2855`). And the question that kills it:
  **what does this deliver, today, that Option B does not?** The honest answer, at the
  product's current stage, is download telemetry and fast takedown. Neither is worth a
  backend before there are users. Above all: #12 established that Blackfin **cannot contain**
  an extension after install, so it **should not be the party that hosts and blesses it** —
  Option C manufactures a transitive-trust liability the product cannot honour.
- **Cost of error:** high and recurring. It is the option that turns a desktop app into an
  infrastructure company.

### Option D — Federate: aggregate the marketplaces that already exist

Do not *be* a registry; be a **client** of the existing ones (Claude Code's, MCP indexes,
community lists). Blackfin normalises other people's catalogs into its own domain (#10) and
presents one unified search. It **indexes and installs from what exists; it hosts nothing.**

- **For:** it is literally the product thesis — *Blackfin normalises a fragmented ecosystem
  nobody else can see at once*. Zero own curation. The user installs from where the thing
  actually lives, and Blackfin says where that is. It puts #10's translation table to the
  use it was built for.
- **Against:** dependency on other people's formats, which change without notice and without
  contract. Each source is a parser, a failure mode and a maintainer. Quality and coverage
  vary. Not every registry has a stable API; some have no API at all.
- **Cost of error:** medium, and **continuous** (parser maintenance), but no backend.

### Recommendation

**Option B as the spine, with Option D added per source, incrementally. Option C is
rejected until there is evidence of demand; Option A is what remains standing if M3 is cut —
and this document states that this is acceptable.**

Rationale:

1. **Blackfin must not become an infrastructure liability before it has users.** Option C
   buys scale problems the product does not have, and a supply-chain responsibility that —
   by #12 — it **cannot honour**: we cannot contain an extension after install, therefore we
   should not be the party that hosts and blesses it.
2. **A static Git index delivers 90% of the value at 5% of the cost.** Discovery,
   categories, authors, changelog, compatibility, and moderation-by-PR — without a single
   server. And it is additive: if Option C is ever necessary, the static index becomes its
   first export.
3. **Federation (D) is the thing only Blackfin can do.** No other product sees fourteen
   agents at once. An own registry competes with Claude Code's; an **aggregator** competes
   with nobody and is the product thesis realised. But it is fragile because it depends on
   third parties, so it cannot be the spine — it is a layer on top.
4. **Blackfin never hosts the bytes.** The index points at the origin (Git repo, release).
   This keeps provenance strong (#12: "came from `github.com/foo/bar@abc123`") and prevents
   Blackfin from becoming the distribution vehicle for a malicious package.

This is a strategic product decision. The recommendation above is engineering's; the call is
the maintainer's, and it is recorded as **D1** and **D5** in "DECISÃO PENDENTE (ratificar)".

## 6. The registry shape

For whichever direction is ratified, the shape below is what a catalog entry is. It follows
one rule from #12 into the very field names: **it stores the author's CLAIMS, not facts.**
The distinction (`claimedAuthor`, not `author`) crosses the type boundary because the
marketplace is the primary place a third party's assertion would be mistaken for something
Blackfin verified.

### 6.1 Catalog entry (the sketch — implemented by #47, not created here)

```ts
// PROPOSED shape (not created by this RFC). Implemented by the registry client (#47),
// stored in a standalone, throwaway Dexie database (§7). Mirrors what the author
// DECLARED — not facts. Cross-references the marketplace item page (#49).

/** One entry in the index. */
export interface ICatalogEntry {
  readonly id: string //                       'author/name'
  readonly name: string
  readonly description: string
  /** The ratified taxonomy's Extension shape; NEVER a bare mcp-server (#10 §6.3). */
  readonly kind: ExtensionKind //              rfc-extension-model
  /** Which agents this extension serves. */
  readonly agents: ReadonlyArray<AgentId>
  /** CLAIMED. Never verified. The UI must say so (rfc-trust, #12). */
  readonly claimedAuthor: string
  readonly homepage: string | null
  readonly categories: ReadonlyArray<string>
  readonly versions: ReadonlyArray<ICatalogVersion>
  /** Popularity: stars of the ORIGIN repo, not downloads. Blackfin measures no downloads. */
  readonly stars: number | null
}

export interface ICatalogVersion {
  readonly version: string //                  semver string; see §8
  readonly publishedAt: number
  readonly changelog: string | null
  /**
   * Where the BYTES come from. Blackfin NEVER hosts them (D5). An exact commit is
   * stronger provenance than "from the marketplace". Maps to #11's `source`:
   * a catalog install lands as source = 'marketplace', with the git/url origin in sourceRef.
   */
  readonly source:
    | { readonly kind: 'git'; readonly url: string; readonly ref: string }
    | { readonly kind: 'tarball'; readonly url: string }
  /** Proves the bit did not change in transit. Does NOT prove it is safe (#12; #51). */
  readonly checksum: string | null
  /** DECLARED compatibility. `null` range ⇒ unknown — and the UI says "unknown". */
  readonly agentCompatibility: ReadonlyArray<{
    readonly agent: AgentId
    readonly range: string | null
  }>
  /** Channels (#52). Tags in the index, no infrastructure. */
  readonly channel: 'stable' | 'beta' | 'experimental'
}
```

Mandatory vs. optional: `id`, `name`, `kind`, `agents`, `claimedAuthor` and at least one
`ICatalogVersion` with a `source` are **mandatory** — an entry missing any of them is
**ignored, with a reason**, and does not blind the rest of the index (same principle as
`scan-global.ts:78`: a malformed item is an answer, not a crash). Everything else
(`homepage`, `categories`, `changelog`, `checksum`, `stars`, `agentCompatibility`) is
**optional**, and the UI must render well with all of them null — because that is most of the
real world (#11 §5.5).

How an entry relates to `IExtensionManifest` (#11 §5.5): the catalog entry is a **superset**
of the manifest for discovery. The manifest is the author's file on disk (`name`, `version`,
`description`, `author`, `license`, `homepage`, `provides`, `requiresMcp`); the catalog entry
adds the discovery-only fields the manifest has no reason to carry — `categories`, `stars`,
`channel`, normalised `agentCompatibility`, and the per-version `source` pointer. **The
catalog never contradicts the manifest**; on install, the manifest read from the fetched
bytes is the truth, and a mismatch with the catalog claim is surfaced, not silently
reconciled (see **D3**).

### 6.2 The local catalog cache — throwaway, and NOT install data

The catalog is a **cache of a remote resource**. It gets its **own** standalone Dexie
database, `MarketplaceDatabase`, never a new table on `WorkspaceDatabase` or on the
repositories database. This is the doctrine the codebase already applies
(`workspace-database.ts:5-13`) and that #14 formalises: a cache that is lost is a cache that
is rebuilt, and a cache never shares a database with real data.

```ts
// app/src/lib/databases/marketplace-database.ts  (PROPOSED; implemented by #47)

export class MarketplaceDatabase extends BaseDatabase {
  public declare entries: Dexie.Table<ICatalogEntry, string>
  public declare meta: Dexie.Table<ICatalogMeta, string>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)
    // Same pattern as WorkspaceDatabase:28-30.
    this.conditionalVersion(1, {
      entries: 'id, kind, *agents, *categories',
      meta: 'key',
    })
  }
}

/** ETag / Last-Modified of the index, so the same JSON is not re-downloaded needlessly. */
export interface ICatalogMeta {
  readonly key: 'index'
  readonly etag: string | null
  readonly fetchedAt: number
}
```

**Cache invariants:**

- This database is **cache**. Losing it costs a download. **Nothing of Blackfin's**
  (installs, trust decisions, pins) lives here — that is `IExtensionRecord`, in another
  database (#11 §7, #14). An explicit **negative assertion** #47 must test: no
  `IExtensionRecord`, trust decision or pin ever appears in this database.
- **No token, credential or secret is persisted.** The registry is public and
  unauthenticated. A `GET` of a static file has nobody to authenticate to. If it ever needs
  auth, that is a new and explicit decision — and the token does **not** go into this
  database. This is the same firm invariant #11 §13 states for the extension record.
- `ICatalogEntry` holds **claims**, not facts — `claimedAuthor`, not `author`.

### 6.3 Versioning and what "update" means

- **Version is the `IExtensionRecord.version` from #11.** `installedVersion` is what is on
  disk; the catalog's newest `ICatalogVersion.version` is what is available. Comparing the
  two is the whole of "outdated."
- **Semver where the author provides it; a string otherwise.** Comparison uses semver when
  both sides parse as semver; when they do not (many extensions are not versioned at all, or
  version by date or by commit), Blackfin compares for **equality only** and says "a
  different version is available," never "newer" — it does not invent an ordering it cannot
  justify.
- **"Outdated" is a computed state (#11 §5.4).** It requires an install record **and** a
  catalog entry: `installedVersion` (Blackfin) and the available version (this RFC). A
  `detected` item — one Blackfin did not install — can **never** be `outdated`, and the UI
  must not pretend it can. `outdated` feeds directly into #11's `ExtensionState`
  (`{ kind: 'outdated'; available: string }`), computed in memory, never stored.
- **A pinned version suppresses the notification.** `pinnedVersion` (#11 §6) means "leave me
  alone" — no "update available" nudge while pinned.

## 7. Distribution and install sources — mapped to #11's `source`

This RFC defines **distribution** — how the bytes reach the disk. It does **not** define the
trust decision (that is #12/#50) nor the integrity/signature mechanics (that is #51). It maps
distribution onto the `source` #11 already ratified:

| Where the user installs from | #11 `source` | `sourceRef` holds | Notes |
|---|---|---|---|
| A catalog entry (Option B/D) | `marketplace` | the catalog `id` **and** the resolved git/url origin | The catalog is a pointer; the bytes come from the origin it names. |
| A Git URL pasted directly (#38, M2) | `git` | the git remote + ref (commit) | The Option A floor. Strongest provenance: an exact commit. |
| A tarball / release URL (#39, M2) | `url` | the URL | Easier to hash; weaker provenance than a commit. |
| A local folder | (`installed-by-blackfin`) | the source path | No network; still passes the same install-safety gate. |

**How the artifact reaches disk (D4).** Recommendation: **shallow Git clone by tag**, because
it yields the strongest provenance (an exact commit) and reuses `app/src/lib/git/`, which
already exists. A release tarball is faster and easier to hash but records a weaker origin.
Either way, **Blackfin never hosts the bytes** (D5): the catalog points at the origin, and if
that origin disappears, the install fails as a *result*, not as an exception, and the UI says
so plainly. The first time an origin repository vanishes, someone will propose a mirror —
which is why "Blackfin hosts bytes: never" must be a **recorded decision, not an omission**
(D5).

**The boundary with trust.** This RFC gets the bytes to a staging point and records where
they came from. It does **not** decide whether to trust them. Every install passes through
#50's permission review with #12's capability disclosure (`IExtensionDisclosure`) before
anything lands active; integrity/signature verification is #51. This document says *where*
those checks sit in the flow; it does not redefine what they prove.

## 8. Update semantics (normative)

This is the least negotiable part of the document.

- **Nothing is updated automatically. Ever. Not in the background.** An agent is a system
  that executes instructions with the user's permissions; silently updating the instructions
  it reads is the definition of a silent compromise route. #41 is already "**Manual** update
  and version pinning" — this RFC ratifies that and forbids the alternative. There is no
  poller, no auto-update, no silent background rewrite.
- **Blackfin *checks* for new versions** (against the cache, with ETag, without blocking the
  UI) **and *notifies*.** The user decides. Recommended cadence: **on demand + at start with
  ETag**, never a poller (D7).
- **An update that *adds capability*** (a new hook, a new MCP server) **requires fresh
  approval** — #12, `approvedCapabilitiesHash`. No exception. This is the single most
  important behaviour in the whole document: a version bump that widens what the extension
  can do is a new trust decision, not a patch.
- **An update over a `locallyModified` item stops and warns.** It never overwrites a user's
  edit. `contentHashAtInstall` (#11 §6) exists exactly to make this detectable: current hash
  ≠ install hash ⇒ the user hand-edited it ⇒ Blackfin refuses to overwrite and says why.
- **Rollback and uninstall go through the safe flow of #30:** revalidate, confirm the path,
  identify dependencies, report impact, trash, record the outcome — the same rigour as
  `checkDeletable` (`cleanup.ts:55-123`).

## 9. Compatibility — and the honesty it demands

- An entry declares `agents: AgentId[]` and, **when the agent versions**, a range. **Most do
  not version in a way that supports a range.** In that case Blackfin says *"compatibility
  unknown"* — it does not invent a green checkmark.
- **Blackfin does not block on declared incompatibility. It warns.** The declaration comes
  from a stranger (#12: `claimedAuthor` is a claim, not a fact), and blocking on a third
  party's claim hands that third party power over the user's app (D8).

## 10. Security posture

The supply-chain surface a marketplace opens is real, and these are the invariants that
contain it. None of them re-litigate #12 or #51; they state where this RFC sits relative to
them.

- **A marketplace cannot reintroduce the promise #12 demolished.** Blackfin does not execute
  extensions and cannot contain them. **Nothing executes on install** — Blackfin writes files
  the agent will later read; it never runs them. No badge, seal or "Verified" shown in the
  marketplace may suggest otherwise. An item "from the official marketplace" is **no safer**
  than an item from any Git repo — it is only *easier to find*, and the UI must make that
  uncomfortably clear.
- **Blackfin never hosts the bytes** (D5). The index points at the origin. This keeps
  provenance strong and stops Blackfin from becoming the distribution vector.
- **A checksum proves one thing only:** that the file did not change between publication and
  download. It does not prove intent, and it is not a signature. The full integrity/signature
  story — a key chain someone actually operates — is **#51**; a signature with a key nobody
  manages is theatre, so checksum comes first (see the deferral in §11).
- **No secret is ever persisted.** The catalog is a public GET; the install record has no
  slot for a token (#11 §13). Review of #47 must reject any field that opens one.
- **Every install passes through #50/#12.** There is no install path that skips the
  permission review with capability disclosure. No "install everything," no "trust this
  author forever."
- **Every write to disk matches the rigour of `checkDeletable`** (`cleanup.ts:55-123`): the
  path is contained within the destination, **symlinks are refused** (`:84`), the check
  happens at the instant of the act, and failure is a result, not an exception (`:22-33`). A
  package with `../` in a path is refused.
- **No automatic update** (§8). It is the most obvious silent-compromise vector this product
  has.
- **Never overwrite a local edit** (`locallyModified`, #11).
- **The network is always optional.** The local inventory **must not** come to depend on the
  registry. Today the app works entirely offline; that property must not regress. A registry
  failure is a *result* — not an exception, not a block, not an eternal spinner (the doctrine
  of `scan-global.ts:78`: *"That's not an error, it's an answer."*).
- **No telemetry.** Blackfin does not report to the registry what the user installed,
  searched for, or has on disk. The index is a GET of a static file — with a JSON on a CDN,
  **there is nobody to leak to**, which is one more argument for Option B.

## 11. Deliberately deferred (each with a reopen trigger)

- **Backend and own API (Option C)** → reopen if moderation-by-PR cannot keep up, or if fast
  takedown becomes a real need.
- **Download telemetry / real popularity** → reopen together with C. Until then, order by the
  origin repo's stars, **stating that this is what it is**.
- **Self-service publishing (#54)** → a PR against the index repository is the v1 publishing
  mechanism.
- **Beta/experimental channels (#52)** → tags in the index; no infrastructure.
- **Cryptographic signatures (#51)** → checksum first; signatures when there is a key chain
  someone actually operates. A signature with an unmanaged key is theatre.
- **Federation of a given source (Option D)** → after B stands up, one federated source at a
  time (D6).

## 12. Decision register

| # | Decision | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| D1 | Static Git index (B) + incremental federation (D)? Or is M3 cut in favour of #38 (A)? | **B as spine + D incremental; A is the acceptable fallback; C rejected.** | @matbrgz | all of M3 |
| D2 | Does the index live in a separate repo (`matbrgz/blackfin-registry`) or inside `matbrgz/blackfin`? | **Separate** — lets third parties PR without touching the app. | @matbrgz | #47, #54 |
| D3 | Catalog-entry schema: mirror `IExtensionManifest` (#11) or a richer own schema (categories, tags, screenshots)? | **Superset of the manifest** (§6.1); manifest read at install is the truth; a mismatch is surfaced, not reconciled. | eng | #47, #49 |
| D4 | Distribution: shallow Git clone by tag, or release tarball? | **Git**, for the exact commit and to reuse `app/src/lib/git/`. | eng | #47, #38 |
| D5 | Does Blackfin **host bytes** at any point? | **No, never.** Recorded decision, not omission — the first vanished origin will prompt a mirror proposal. | @matbrgz | #51, legal |
| D6 | Federation (D) in v1, or after B stands up? | **After** — B first, one federated source at a time. | @matbrgz | #47 |
| D7 | Update-check frequency: at start? daily? on demand only? | **On demand + at start with ETag.** Never a poller. | eng + design | #52 |
| D8 | Compatibility: block a declared-incompatible install, or only warn? | **Only warn** — the declaration is a third party's. | @matbrgz | #49, #50 |
| D9 | If the registry were GraphQL, it drags in GraphQL infrastructure that does not exist (`api.ts:2855` is the only call). | **Static JSON, never GraphQL** — Option B makes the question moot, and is one more argument for it. | eng | #47 |

None of D1–D9 may remain in `open` status at merge of the implementation issues; here they
carry recommendations awaiting ratification.

## 13. DECISÃO RATIFICADA

**RATIFICADO pelo mantenedor.** Both strategic calls are settled; M3 (#47, #48, #49, #52, #54)
may proceed on them:

- **D1 = Option B (static Git index) as the spine + Option D (federation) incrementally.**
  Option C (own backend) is **rejected**; Option A (Git/URL install only) is the acceptable
  fallback if M3 is cut.
- **D5 = Blackfin NEVER hosts bytes** — it only indexes/points; artifacts live at their origin.

The original recommendation matched the ratification. The engineering reasoning is preserved
below for the record.

The two strategic decisions the maintainer must rule on:

- **D1 — Build a registry at all, and of which kind?** The recommendation is B + D. The cost
  of getting this wrong is money and trust: Option C commits the product to a permanent
  operational liability and to a supply-chain responsibility that #12 already showed Blackfin
  **cannot honour**. This is the one RFC in M0 whose best answer might be "do not build this"
  (Option A), and the document states that outcome is acceptable.
- **D5 — Does Blackfin ever host bytes?** The recommendation is **never**. It must be a
  recorded decision because the first time an origin repository disappears, a mirror will be
  proposed — and a mirror is the step that turns the index from a pointer into a distribution
  vehicle, reintroducing the exact liability #12 forbids.

The remaining decisions (D2–D4, D6–D9) are engineering/design calls recorded with
recommendations; they are settled at implementation, not here.

## 14. Out of scope

- **Trust, permissions, capability review.** That is #12 and #50. This RFC says *where* the
  review sits in the install flow; it does not define what it proves.
- **Integrity, signatures, provenance mechanics.** That is #51. This RFC says checksum comes
  first and signatures are deferred; it does not design the key chain.
- **The concrete Dexie schema, migrations, cache policy.** That is #14. §6.2 is the logical
  boundary only.
- **The marketplace UI.** That is #48 (browse) and #49 (item page).
- **Publishing, curation, moderation.** That is #54; it depends on this RFC.
- **Organisational policy, allowlist, blocking.** That is #53.
- **Writing any code, client or schema.** That is #47.
- **Building GraphQL infrastructure** (`api.ts:2855` — one call in the whole codebase). If the
  registry were GraphQL it would be a heavy dependency; Option B makes it a non-question (D9).
- **Promising sandbox, containment or content-safety verification.** #12 already demonstrated
  Blackfin cannot contain an extension; a marketplace must not smuggle that promise back in
  through a green badge.
- **Automatic, silent or background update.** Forbidden by §8.
- **Hosting, executing or supervising any agent or MCP server.** Blackfin does not host
  agents.

## 15. Files cited (read, not modified)

- `app/src/models/workspace-inventory.ts:95-114` — `IContextFile`: no `version`, no `source`,
  no `author`. There is no version concept in the domain today. `:14-29` — `AgentId`, the
  fourteen agents.
- `app/src/lib/databases/workspace-database.ts:5-13` — *"A cache that is lost is a cache that
  is rebuilt"*; standalone database so a cache migration cannot risk real data. The
  marketplace catalog inherits this rule. `:28-30` — the `conditionalVersion` pattern
  `MarketplaceDatabase` follows.
- `app/src/lib/databases/base-database.ts:23-37` — `conditionalVersion`.
- `app/src/lib/workspace/cleanup.ts:55-123` — `checkDeletable`: the rigour a marketplace
  installer must match. `:84` (symlink refusal), `:22-33` (`CleanupOutcome`, failure as
  result), `:50-52` (dependency injection to keep the module testable and Electron-free).
- `app/src/lib/workspace/scan-global.ts:78` — *"The agent simply isn't installed. That's not
  an error, it's an answer."* — the doctrine the network client follows: failure is a result.
- `app/src/lib/api.ts:2855` — the single GraphQL call in the whole codebase (`docs/BRIEFING.md`
  §5). A GraphQL registry would build a foundation from scratch (D9).
- `docs/BRIEFING.md` §3 — Blackfin observes and organises; it does not host. §5 — no GraphQL
  infrastructure; anchors are never line indices.
- `docs/superpowers/rfcs/2026-07-12-taxonomy.md` — the ratified Extension/Capability
  vocabulary this document distributes.
- `docs/superpowers/rfcs/2026-07-12-extension-model.md` — the ratified `source`,
  `IExtensionRecord`, `contentHashAtInstall` and cache/real-data boundary this document writes
  against.
- Backlog: #38 and #39 are already in **M2** — install-from-Git exists *before* any
  marketplace, which is the basis of Option A and the floor every other option justifies
  itself against.

## 16. Acceptance criteria (self-check)

- [x] The document exists at `docs/superpowers/rfcs/2026-07-12-marketplace-arch.md`.
- [x] It answers explicitly **"Does Blackfin need its own registry?"**, justified against
      #38 (M2) already existing (§1, §2, §5).
- [x] The four options (no registry / static index / service / federation) are recorded with
      trade-offs, and Option C's rejection is argued in terms of operational cost **and** #12
      (do not bless what you cannot contain) (§5).
- [x] The catalog-entry shape is defined, distinguishing **facts** from **author claims**
      (`claimedAuthor`, not `author`) (§6.1).
- [x] The distribution mechanism is decided (D4) and the document states whether Blackfin
      hosts bytes (D5) — a recorded decision, not an omission (§7, §12).
- [x] Versioning and compatibility are defined, **including the majority case where the agent
      does not version** — and what the UI shows then ("compatibility unknown", not a green
      check) (§6.3, §9).
- [x] Update semantics are normative and include, textually: **nothing is updated
      automatically**; an update that **adds capability** requires fresh approval; an update
      over a `locallyModified` item stops and warns (§8).
- [x] The **deliberately deferred** list exists, and **each item has a reopen trigger** (§11).
- [x] The document states the local inventory keeps working **entirely offline**, and that a
      registry failure is a result, never a block (§10).
- [x] The document states there is **no telemetry** and the registry does not know what the
      user has installed (§10).
- [x] The catalog is specified as an **independent Dexie database**, consistent with
      `workspace-database.ts:5-13` and #14 (§6.2).
- [x] Decisions **D1–D9** are in a table with owner and status; none is `open` at merge (§12).
- [x] #47, #48, #49, #52 and #54 can be written from this document (§4–§12).
