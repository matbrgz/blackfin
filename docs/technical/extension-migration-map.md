# The inventory → extension-model migration map

- **Issue:** [#21](https://github.com/matbrgz/blackfin/issues/21) — *Reconcile the shipped workspace inventory with the extension model*
- **Governed by:** `docs/superpowers/rfcs/2026-07-12-taxonomy.md` (#10) and `docs/superpowers/rfcs/2026-07-12-extension-model.md` (#11, **RATIFIED**). Where this document and those disagree, they win.

The workspace inventory shipped before the extension model existed. This is the
record of what happens to every symbol in it — kept as a document rather than as
commit archaeology, because five issues in M1 and every issue in M2 read these
types and need to know which of them are load-bearing and which are transitional.

**The rule the whole map obeys:** the inventory is the *observation of disk*, and
nothing in the extension model may change what it observes. So the migration is
**strictly additive**. Nothing below is deleted, renamed, or given a new field.

## The map, symbol by symbol

| Symbol | Fate | Note |
|---|---|---|
| `AgentId` | **unchanged** | Fourteen agents. The extension model reuses it as-is, including `Shared` — which is not an agent but the `AGENTS.md` convention, and is deliberately not expanded into its readers (see below) |
| `ContextRole.Skill\|Command\|Subagent\|Prompt\|Hook` | → `CapabilityKind` | 1:1, via `capabilityKindForRole` (`extension.ts:275`) |
| `ContextRole.Instructions` | → `CapabilityKind.Instruction` | A `CLAUDE.md` is a capability but never an *installable* one. It maps through so it can be listed and inherited/overridden; nothing installs it |
| `ContextRole.Settings` | **stays, and becomes a source** | Maps to `null`. A settings file *declares* mcp-servers; it is not one. Extracting them is I/O over a real file — #43 |
| `ContextScope` | **unchanged** | `Worktree` does **not** enter here. See "Deferred", below |
| `IContextFile` | **unchanged**, and becomes the input | Still what the scanner produces: the raw observation. `extension-adapter.ts` reads it; it never reads back |
| `IContextReference` | **unchanged** | `exists` is carried straight through — it is what makes a capability `broken` |
| `IArtifactDirectory`, `IDocFile` | **unchanged** | Not extensions, and never will be |
| `IRepositoryInventory`, `IGlobalContext` | **unchanged** | The shape of a scan does not move |
| `InventoryStatus` | **unchanged** | #19 consumes it |
| — | **new**: `IDetectedCapability` | Side A of the boundary — `extension.ts:159` |
| — | **new**: `capabilityIdentityKey` | The derived identity that did not exist — `extension.ts:397` |
| — | **new**: `extension-adapter.ts` | The projection. Pure, no I/O, one-directional |

### Files explicitly not touched

The acceptance criterion for this migration is that `git diff --stat` is empty
for all of them, and it is:

`scan.ts` · `scan-global.ts` · `parse.ts` · `context-file-reader.ts` ·
`discover-repositories.ts` · `cleanup.ts` · `catalog.ts`

## Derived identity

A detected item has no manifest id, because nobody registered it. Its identity is
**derived, deterministic and pure**:

```text
identity = (kind, agent, logicalName)
  where logicalName = frontmatter.name ?? basename of the manifest's directory
```

The path is the **location**, not the identity. That distinction is the whole
reason #23 and #24 become writable: *"the skill `code-review` exists in Global
and in Project"* is a statement about one identity at two locations, and it is
unsayable as long as an item is only its `relativePath`.

Implemented by `logicalNameFor` (`extension.ts:374`) and `capabilityIdentityKey`
(`extension.ts:397`). Hostile names are sanitised and a name is never a path.

## The three facts the adapter refuses to invent

The inventory does not contain everything `IDetectedCapability` declares. Each
gap is an **input** supplied by the caller, never a guess — because the failure
mode of guessing here is not a blank field, it is a confident lie.

| Fact | Why it is missing | What the adapter does |
|---|---|---|
| `contentHash` | `IContextFile` records `byteLength`, `lineCount`, `modifiedAt` — the scanner never keeps the bytes it parsed | Emits `UnknownContentHash` unless a `contentHashOf` resolver is supplied. `reconcile()` treats the sentinel as *cannot tell*, so an unread item is never reported as hand-edited |
| `disabled` | Per RFC #11 §11 (D4) disabling is an explicit edit of the agent's own config, read **back** from disk. No shipped scanner observes it | `false` unless the path is in the caller's `disabledPaths`. The caller's knowledge, not the adapter's assumption — #40, #43 |
| `manifest`, `mcp` | `parse.ts` extracts `name` and `description` and says so plainly (*"This is not a YAML parser and does not pretend to be"*) | Always `null`. Absence is the common case anyway (RFC #11 §5.5) |

And one fact it declines to expand: `AgentId.Shared` stays a single-element
`agents` array. Which of Codex, OpenCode, Amp or Antigravity are installed on
*this* machine is not something an inventory knows, and listing them would be a
claim about the user's machine that nobody verified.

## The boundary, restated

- The **scan** observes disk. It writes nothing, and its result never carries a
  trust decision, an installed version, or any other Blackfin opinion.
- The **record** (`IExtensionRecord`, #35) holds what Blackfin knows: origin,
  pinned version, granted trust. Real data, not cache — its own Dexie database,
  never pruned by a rescan.
- The **join** happens at read time, through the derived identity, in
  `reconcile()`. An item on disk with no record is *detected, not trusted*. A
  record with no item on disk is an **orphan** — reported, never deleted (#25).

The adapter sits entirely on the disk side of that line. It cannot read a
record, and nothing downstream can make it write one.

## Deferred, with the trigger that reopens each

- **`ContextScope.Worktree`.** RFC #11 §5.2 admits `worktree` into
  `CapabilityScope`, and `CapabilityScope.Worktree` exists today. `ContextScope`
  does **not** gain it now: no scanner produces it, and an enum member nothing
  can emit is dead code that every exhaustive switch must still handle.
  **Trigger:** M4, when worktree scanning lands and there is a producer.
- **`WorkspaceDatabase` v1 → v2.** No migration is required, because nothing in
  the cached inventory shape changed — the migration is additive and lives
  outside it. **Trigger:** the first change to `IRepositoryInventory` itself, at
  which point the upgrade is a *discard* (the database's own header: *"a cache
  that is lost is a cache that is rebuilt"*).
- **mcp-server capabilities.** Reachable only by opening a settings file.
  **Trigger:** #43.
- **Content hashing during the scan.** Would make `contentHashOf` unnecessary,
  at the cost of reading every context file on every scan. **Trigger:** the
  first feature that needs edit detection to be automatic rather than
  caller-supplied — #29.

`KindsReachableFromInventory` (`extension-adapter.ts`) pins the first item of
that list in a test: if a `ContextRole` ever starts mapping to a new kind, the
suite fails and this document has to be updated with it.
