# Blackfin — Agent Control Center

**Date:** 2026-07-12
**Status:** Approved, not yet implemented

## Context

This repository is a fork of GitHub Desktop, currently shipping as "GH Desktop Plus".
It is being repositioned as **Blackfin — the Agentic Control Center for Developers**:
a desktop client that treats *the context you give your coding agents* as a
first-class artifact, tracked and reviewed alongside the code itself.

Every project a developer works on now carries agent configuration — `CLAUDE.md`,
`AGENTS.md`, Cursor rules, Copilot instructions — and today that configuration is
invisible. It drifts, it duplicates, it references files that no longer exist, and
nobody notices because no tool ever looks at it. Blackfin looks at it.

## Scope

Four phases, each with its own implementation cycle. Phases 1 and 2 are new product
surface; phase 3 is infrastructure that touches the entire release pipeline and is
deliberately sequenced last so that broken builds during feature work are not
confounded with rebrand fallout.

| Phase | Deliverable | Branch |
| --- | --- | --- |
| 0 | README and product narrative | `main` |
| 1 | Agent Context: cross-project center, per-project screen, repo nav | `blackfin/agent-context` |
| 2 | Project Overview (GitHub-style landing) | `blackfin/repo-overview` |
| 3 | Technical rebrand: bundle IDs, update URLs, packaging, icons | `blackfin/rebrand` |

**This document specifies phases 0 and 1.** Phases 2 and 3 are sketched at the end
for sequencing purposes and will get their own specs.

## Existing architecture this builds on

Findings from exploring the codebase, recorded here so the implementation plan does
not have to rediscover them:

- The fork **already added a third repository tab ("Compare")** in commit `0bf9b45832`.
  That commit is the exact template for touching the tab/section machinery
  (`RepositorySectionTab` at `app/src/lib/app-state.ts:526`, the mapping functions in
  `app/src/ui/repository.tsx:266-302`, the dispatcher at
  `app/src/ui/dispatcher/dispatcher.ts:368`, and `AppStore._changeRepositorySection`
  at `app/src/lib/stores/app-store.ts:3855`).
- Full-screen views use the `<UiView>` wrapper (`app/src/ui/ui-view.tsx`) and are
  switched in `App.renderRepository()` (`app/src/ui/app.tsx:4079`).
  `NoRepositoriesView` is the precedent.
- Reading a working-directory file is plain `readFile` from `fs/promises` joined
  against `repository.path`. The best exemplar, including the size guard, is
  `app/src/lib/copilot-conflict-context.ts:325-340` (1 MB limit after a `stat()`).
- There is **no** generic working-tree walker. We build one.
- Dexie databases live in `app/src/lib/databases/`. Adding a table to an existing
  database requires bumping its schema version via `conditionalVersion`
  (`app/src/lib/databases/base-database.ts:25`). Standalone databases
  (`issues-database.ts`) are the alternative.
- `SandboxedMarkdown` (`app/src/ui/lib/sandboxed-markdown.tsx`) already exists and is
  the renderer to reuse.
- `setupFixtureRepository` (`app/test/helpers/repositories.ts`) is the helper for
  tests that need a real git repository on disk.

## Navigation model

The repository tab bar lives *inside* the sidebar, which defaults to roughly 250px.
It already holds `Changes | History | Compare`. Adding two more tabs would leave each
around 50px — too narrow for labels. Separately, neither of the new screens wants a
sidebar at all: both want full width.

So we introduce a **repository-level nav bar above the working area**, mirroring
GitHub's own `Code | Issues | Pull requests` model:

```
┌─ blackfin ────────────────────────────┐
│ Overview │ Code │ Agents              │  ← new
├──────────┬────────────────────────────┤
│ Changes  │                            │
│ History  │   (diff / commits)         │  ← "Code" is today's app, untouched
│ Compare  │                            │
│──────────│                            │
│ file.ts  │                            │
└──────────┴────────────────────────────┘
```

`Code` is the entire current layout — sidebar, tabs, diff pane — with no changes to
it. This is what keeps the commit flow, the highest-traffic path in the app, free of
regression risk. `Overview` and `Agents` are full-width screens with no sidebar.

In phase 1, `Overview` is hidden behind a flag until phase 2 gives it content.

## Phase 0 — README and narrative

Rewrite `README.md` around the Blackfin positioning. The existing feature list (the
fork's additions over GitHub Desktop) stays, because it is real and it is the
product's foundation — but it moves below the new agentic-control-center framing
rather than being the headline.

No code, no bundle IDs, no build changes. This phase is reversible and ships alone.

## Phase 1 — Agent Context

### What counts as agent context

Discovered at the repository root *and* in subdirectories (a monorepo's
`packages/api/CLAUDE.md` matters as much as the root one):

| Kind | Files |
| --- | --- |
| `Claude` | `CLAUDE.md`, `CLAUDE.local.md` |
| `Agents` | `AGENTS.md` |
| `Gemini` | `GEMINI.md` |
| `Cursor` | `.cursorrules`, `.cursor/rules/*.mdc` |
| `Copilot` | `.github/copilot-instructions.md` |
| `Windsurf` | `.windsurfrules` |

Plus the `.claude/` directory's contents (skills, commands, agents, settings), which
are inventoried but not deeply parsed.

### What we extract

Analysis is **fully deterministic — no LLM, no network, works offline**. Per file:

- Path (relative), kind, byte length, line count
- Last modified time (used for cache invalidation)
- Content hash (cache invalidation, and cross-project duplicate detection)
- Heading tree
- Rule count (bullet and imperative lines)
- References: Claude-style `@imports` and relative markdown links — **each resolved
  against the filesystem, so broken references are surfaced.** This is the single
  most useful signal the center can offer, and it is why the design bothers to
  resolve rather than just list.
- Frontmatter, for `.mdc` files that have it

### Layers

Five, each with one responsibility and independently testable. The governing rule:
**all parsing is a pure function with no I/O.** That is where the complexity lives,
so that is where the tests live.

**`app/src/models/agent-context.ts`** — types only.

```ts
export enum AgentContextKind {
  Claude, Agents, Gemini, Cursor, Copilot, Windsurf,
}

export interface IAgentContextFile {
  readonly kind: AgentContextKind
  readonly relativePath: string
  readonly byteLength: number
  readonly lineCount: number
  readonly modifiedAt: number
  readonly contentHash: string
  readonly headings: ReadonlyArray<IAgentContextHeading>
  readonly ruleCount: number
  readonly references: ReadonlyArray<IAgentContextReference>
  readonly frontmatter: ReadonlyMap<string, string> | null
}

export interface IAgentContextReference {
  readonly raw: string
  readonly resolvedPath: string
  readonly exists: boolean
}

export type RepositoryScanStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string }

export interface IRepositoryAgentContext {
  readonly repositoryId: number
  readonly scannedAt: number
  readonly status: RepositoryScanStatus
  readonly files: ReadonlyArray<IAgentContextFile>
}
```

**`app/src/lib/agent-context/discovery.ts`** — given a repository path, return
candidate file paths. A depth-limited walk that skips `node_modules`, `.git`,
`vendor`, `dist`, `out`, plus direct probes of the known fixed paths
(`.claude/`, `.cursor/rules/`, `.github/copilot-instructions.md`).

**`app/src/lib/agent-context/parser.ts`** — pure.
`(kind, relativePath, content, stat) => IAgentContextFile`. No filesystem access.

**`app/src/lib/agent-context/scanner.ts`** — the I/O boundary. Runs discovery, reads
each file (1 MB guard after `stat()`, following `copilot-conflict-context.ts`), calls
the parser, then resolves each reference against the filesystem to set `exists`.
Returns `IRepositoryAgentContext`.

**`app/src/lib/databases/agent-context-database.ts`** — a standalone Dexie database,
not a new table on `repositories-database`. Standalone avoids a schema migration on
the database that holds the user's actual repositories, so a bug here cannot corrupt
that. Keyed by `repositoryId`.

**`app/src/lib/stores/agent-context-store.ts`** — cache, mtime-based invalidation,
bounded concurrency across repositories, incremental `emitUpdate`.

### Data flow

Opening the center reads the Dexie cache and emits immediately — **the screen paints
full, with no spinner.** In parallel, the store `stat()`s the known files and runs
discovery; only files whose mtime changed are re-read and re-parsed. Changes are
persisted and emitted again. The UI shows `updating 3/12` while this runs.

### Error handling

A scan never aborts as a whole:

- Repository path does not exist → `status: 'missing'`, rendered as a greyed card.
- File over 1 MB → recorded as too large, not parsed.
- Read error on one file → recorded, scan continues to the next.

### State and dispatcher

- `IAppState.agentContext: Map<number, IRepositoryAgentContext>`
- `IAppState.showAgentContextCenter: boolean`
- `Dispatcher.showAgentContextCenter()`, `.scanAgentContext(repository)`,
  `.rescanAllAgentContext()`

### UI

- **`app/src/ui/repository-nav.tsx`** — the `Overview | Code | Agents` bar.
- **`app/src/ui/agent-context/agent-context-center.tsx`** — the full-screen `UiView`.
  All repositories, filterable by agent kind, sortable, and — importantly —
  **surfacing projects with no agent context at all**, since an empty project is the
  finding a control center exists to report.
- **`app/src/ui/agent-context/repository-agent-context.tsx`** — the per-project screen.
- **`app/src/ui/agent-context/agent-file-card.tsx`** — the file card, shared by both
  screens and later by the Overview.
- **`app/styles/ui/_agent-context.scss`**

### Testing

The pure parser carries the weight, with fixtures for: a `CLAUDE.md` containing
`@imports`, a `.mdc` with frontmatter, an empty file, a file that is only headings, a
broken reference, and nested headings.

Discovery and scanner test against a temporary fixture repository via
`setupFixtureRepository`. The scanner test that matters most is the cache one:
**mtime changed → re-parsed; mtime unchanged → served from cache.**

- `app/test/unit/agent-context/parser-test.ts`
- `app/test/unit/agent-context/discovery-test.ts`
- `app/test/unit/agent-context/scanner-test.ts`

## Phase 2 — Project Overview (sketch, separate spec)

A GitHub-style landing page per project: rendered README (reusing
`SandboxedMarkdown`), last commit and when, a 52-week contribution graph, top
contributors, active branches, and an agent-context card reusing `agent-file-card`.

The activity data comes from a single new git wrapper,
`app/src/lib/git/activity.ts`, running one `git log --since=1.year
--format=%at%x00%ae` and bucketing the result by day — one spawn, not one per week.

## Phase 3 — Technical rebrand (sketch, separate spec)

Full fork: product name, bundle identifiers (`com.blackfin.*`), auto-update URLs,
icons, and packaging across winget, Flatpak, and Homebrew, plus a Blackfin releases
repository. This severs auto-update from Desktop Plus, which is the intended
outcome but must be done deliberately.

## Out of scope

- LLM-based summarization of context files. It would require an API key, cost tokens,
  and break the offline guarantee. The deterministic parse is what the center needs.
- Filesystem watchers for live updates. Watchers across N repositories are a known
  source of handle leaks and flakiness. The Dexie-plus-mtime design admits them later
  without rework, if the on-open refresh proves insufficient.
- Editing agent context files from within Blackfin. Read-only first.
