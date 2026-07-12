# Blackfin — Agent Control Center: task breakdown

Companion to [2026-07-12-blackfin-agent-context-design.md](./2026-07-12-blackfin-agent-context-design.md).
Each task below is sized to be a single GitHub issue and a single reviewable commit.

Issues carry a short body (context, acceptance criteria, files, link back to the spec);
the full design rationale lives in the spec, not duplicated in the issue.

## Dependency order

```
BF-1 (types)
  ├─ BF-2 (parser)      ─┐
  └─ BF-3 (discovery)   ─┴─ BF-4 (scanner)
                              ├─ BF-5 (database)
                              └─ BF-6 (store + app state)
                                    ├─ BF-7 (repo nav)
                                    └─ BF-8 (file card)
                                          ├─ BF-9  (per-project screen)
                                          └─ BF-10 (center) ─ BF-11 (styles)

BF-0 (README) is independent and ships first.
```

BF-2 and BF-3 are independent of each other and can run in parallel.
BF-9 and BF-10 are independent of each other and can run in parallel.

---

## BF-0 — Rewrite README around the Blackfin positioning

**Phase:** 0 · **Area:** docs · **Depends on:** nothing

Reframe `README.md` as **Blackfin — the Agentic Control Center for Developers**.
The existing fork feature list stays (it is real and it is the foundation), but moves
below the new framing rather than leading.

**Acceptance criteria**
- README leads with the Blackfin name, tagline, and the problem statement: agent
  context files are invisible, drift, and go unreviewed.
- The inherited Desktop Plus feature list is preserved, demoted to a section.
- No code, bundle ID, or build changes. `yarn markdownlint` passes.

**Files:** `README.md`

---

## BF-1 — Agent context domain types

**Phase:** 1 · **Area:** models · **Depends on:** nothing

Define the types every other layer speaks. No logic, no I/O.

**Acceptance criteria**
- `AgentContextKind` covers Claude, Agents, Gemini, Cursor, Copilot, Windsurf.
- `IAgentContextFile`, `IAgentContextHeading`, `IAgentContextReference`,
  `RepositoryScanStatus`, `IRepositoryAgentContext` exist as specified in the design.
- All fields `readonly`. `tsc` passes.

**Files:** `app/src/models/agent-context.ts`

---

## BF-2 — Pure parser for agent context files

**Phase:** 1 · **Area:** lib · **Depends on:** BF-1

`(kind, relativePath, content, stat) => IAgentContextFile`. **No filesystem access** —
this is the one place the complexity lives, so it must be testable without a disk.

Extracts: heading tree, rule count (bullet and imperative lines), Claude-style
`@imports`, relative markdown links, and `.mdc` frontmatter. References are *collected*
here but `exists` is left unresolved — resolution is the scanner's job (BF-4).

**Acceptance criteria**
- Unit tests cover: `CLAUDE.md` with `@imports`; `.mdc` with frontmatter; an empty
  file; a file that is only headings; nested headings; a malformed/unterminated
  frontmatter block.
- Parser never throws on malformed input — it degrades to fewer extracted fields.

**Files:** `app/src/lib/agent-context/parser.ts`,
`app/test/unit/agent-context/parser-test.ts`

---

## BF-3 — Repository discovery walker

**Phase:** 1 · **Area:** lib · **Depends on:** BF-1

Given a repository path, return the candidate agent-context file paths. The codebase
has no generic working-tree walker, so this builds one.

Depth-limited walk skipping `node_modules`, `.git`, `vendor`, `dist`, `out`, plus
direct probes of the fixed known paths (`.claude/`, `.cursor/rules/*.mdc`,
`.github/copilot-instructions.md`).

**Acceptance criteria**
- Finds root and nested files (a monorepo's `packages/api/CLAUDE.md` is found).
- Ignored directories are never descended into — verified by a fixture with a
  `node_modules/CLAUDE.md` that must *not* appear.
- Tests use `setupFixtureRepository` (`app/test/helpers/repositories.ts`).

**Files:** `app/src/lib/agent-context/discovery.ts`,
`app/test/unit/agent-context/discovery-test.ts`

---

## BF-4 — Scanner: the I/O boundary

**Phase:** 1 · **Area:** lib · **Depends on:** BF-2, BF-3

Runs discovery, reads each file, calls the parser, then **resolves each reference
against the filesystem to set `exists`** — this is what makes broken-reference
detection possible, and it is the single most useful signal the center offers.

Size guard: `stat()` then skip files over 1 MB, following the existing pattern at
`app/src/lib/copilot-conflict-context.ts:325-340`.

**Acceptance criteria**
- Returns `IRepositoryAgentContext`.
- A scan never aborts as a whole: missing repo path → `status: 'missing'`; file over
  1 MB → recorded, not parsed; read error on one file → recorded, scan continues.
- A broken `@import` is reported with `exists: false`; a valid one with `exists: true`.

**Files:** `app/src/lib/agent-context/scanner.ts`,
`app/test/unit/agent-context/scanner-test.ts`

---

## BF-5 — Dexie database for the context index

**Phase:** 1 · **Area:** lib · **Depends on:** BF-4

A **standalone** Dexie database, not a new table on `repositories-database`. Standalone
means no schema migration on the database holding the user's actual repositories, so a
bug here cannot corrupt that. Follow `app/src/lib/databases/issues-database.ts`.

**Acceptance criteria**
- Keyed by `repositoryId`. Stores `IRepositoryAgentContext` including `scannedAt` and
  per-file `contentHash` and `modifiedAt`.
- Exported from `app/src/lib/databases/index.ts`, instantiated in `app/src/ui/index.tsx`.

**Files:** `app/src/lib/databases/agent-context-database.ts`,
`app/src/lib/databases/index.ts`, `app/src/ui/index.tsx`

---

## BF-6 — Store, cache invalidation, and app state

**Phase:** 1 · **Area:** stores · **Depends on:** BF-5

The behaviour that makes the center feel instant: read the Dexie cache and
`emitUpdate` **immediately** — the screen paints full, with no spinner. In parallel,
`stat()` the known files and run discovery; only re-read and re-parse files whose
mtime changed. Persist, emit again.

Bounded concurrency across repositories. Scan progress is observable so the UI can
show `updating 3/12`.

**Acceptance criteria**
- Test: mtime unchanged → served from cache, parser not called.
  mtime changed → re-parsed and persisted. **This is the test that matters most.**
- `IAppState.agentContext` and `IAppState.showAgentContextCenter` added.
- `Dispatcher.showAgentContextCenter()`, `.scanAgentContext(repository)`,
  `.rescanAllAgentContext()` added.

**Files:** `app/src/lib/stores/agent-context-store.ts`, `app/src/lib/app-state.ts`,
`app/src/lib/stores/app-store.ts`, `app/src/ui/dispatcher/dispatcher.ts`

---

## BF-7 — Repository nav bar (`Overview | Code | Agents`)

**Phase:** 1 · **Area:** ui · **Depends on:** BF-6

The repository tab bar lives inside the ~250px sidebar and already holds
`Changes | History | Compare`. Five tabs there would leave ~50px each. So: a new
repo-level nav *above* the working area, mirroring GitHub's `Code | Issues | PRs`.

**`Code` is today's entire layout — sidebar, tabs, diff pane — completely unchanged.**
That is what keeps the commit flow, the app's highest-traffic path, free of regression
risk. `Overview` and `Agents` are full-width, no sidebar.

`Overview` is hidden behind a flag until BF-12 (phase 2) gives it content.

**Acceptance criteria**
- Switching to `Agents` and back to `Code` preserves the Code sub-tab selection.
- Nothing about the Changes/History/Compare experience changes.
- Keyboard navigable; selection persisted per repository.

**Files:** `app/src/ui/repository-nav.tsx`, `app/src/ui/repository.tsx`,
`app/src/lib/app-state.ts`

---

## BF-8 — Shared agent file card

**Phase:** 1 · **Area:** ui · **Depends on:** BF-6

One card component, used by the per-project screen (BF-9), the center (BF-10), and
later the Overview (phase 2). Shows kind, path, size, last modified, heading tree,
rule count, and — prominently — **broken references**.

**Acceptance criteria**
- Renders every `RepositoryScanStatus` and the too-large / read-error file states.
- No data fetching inside the component; it takes an `IAgentContextFile` prop.

**Files:** `app/src/ui/agent-context/agent-file-card.tsx`

---

## BF-9 — Per-project Agents screen

**Phase:** 1 · **Area:** ui · **Depends on:** BF-7, BF-8

The `Agents` nav destination for a single repository: every agent-context file it has,
grouped by kind, with broken references surfaced.

**Acceptance criteria**
- A repository with no agent context shows a deliberate empty state, not a blank pane.
- Rescan is triggerable from the screen.

**Files:** `app/src/ui/agent-context/repository-agent-context.tsx`

---

## BF-10 — Agent Context Center (cross-project full-screen view)

**Phase:** 1 · **Area:** ui · **Depends on:** BF-7, BF-8

The full-screen `UiView` (pattern: `NoRepositoriesView`, switched in
`App.renderRepository()` at `app/src/ui/app.tsx:4079`). Every repository at once,
filterable by agent kind, sortable.

**It must surface projects with no agent context at all** — an empty project is
precisely the finding a control center exists to report, and burying it defeats the
feature.

**Acceptance criteria**
- Reachable from a toolbar button and a keyboard shortcut.
- Paints from cache with no spinner; shows `updating N/M` during the refresh pass.
- Filter by kind, sort by name / last modified / file count / broken references.

**Files:** `app/src/ui/agent-context/agent-context-center.tsx`,
`app/src/ui/app.tsx`, `app/src/ui/toolbar/`

---

## BF-11 — Styles

**Phase:** 1 · **Area:** ui · **Depends on:** BF-9, BF-10

**Acceptance criteria**
- Follows the existing SCSS conventions (`_no-repositories.scss`, `_repository.scss`).
- Correct in both light and dark themes.

**Files:** `app/styles/ui/_agent-context.scss`, `app/styles/_ui.scss`
