# Blackfin — project briefing

*A self-contained handoff for an AI that has never seen this codebase. Read it end to
end before proposing anything. It is written to be pasted into a fresh context.*

---

## 1. What Blackfin is

**Blackfin is the Agentic Control Center for Developers** — a desktop application that
treats *the agent* as a first-class actor in your repositories.

The thesis, stated plainly:

> You don't write most of your code anymore. An agent does. And every tool in your stack
> still assumes you typed every line.

Your git client shows you an 800-line diff with no idea that 600 of those lines came out
of a model at 2am. The `CLAUDE.md` steering that agent has a broken `@import` and nobody
has noticed for three weeks. You have four agents running on four branches and the only
way to know what any of them did is to open four terminals.

The agent became a first-class actor in the repository. The tools didn't notice.
Blackfin is the tool that notices.

---

## 2. Origin — the lineage matters

Blackfin is the third link in a chain, and understanding the chain explains most of the
architectural constraints.

```
GitHub Desktop  (github/desktop)
      │  Electron + React + TypeScript. Mature, trusted, ~10 years old.
      │  Excellent diff viewer, partial staging, history, branch/PR flows.
      ▼
GH Desktop Plus  (desktop-plus/desktop-plus, by Pol Rivero)
      │  An up-to-date community fork. Adds: multi-account, GitLab + Bitbucket,
      │  commit graph, commit search, multiple stashes, repository groups,
      │  pinning, real git worktree support, and — crucially — a working
      │  GitHub Copilot agent integration over stdio.
      ▼
Blackfin  (matbrgz/blackfin)  ← you are here
      Repositioned as an agentic control center. Tracks Desktop Plus upstream.
```

**This is not a greenfield project.** It is a ~10-year-old Electron codebase with an
enormous amount of working machinery. The single biggest failure mode for someone
proposing work here is to design as if the app were empty. It is not. Several things you
would assume need building already exist (§5), and several things you would assume are
easy are structurally blocked (§6).

The rename to Blackfin is complete: product name, bundle identifier (`dev.blackfin.Blackfin`),
CLI (`blackfin-cli`), packaging, icons. Auto-update was already disabled by the upstream
fork, so nothing was severed by the rename.

---

## 3. Orca — the reference point, and what we take from it

**[Orca](https://github.com/stablyai/orca)** (Stably AI, YC-backed, ~17k stars, Electron,
~200-command CLI) is the strongest product in this category and the main influence on
Blackfin's thinking. Read this section carefully — the user considers Orca's **visual
interface** exemplary, and wants Blackfin to reach that bar.

### What Orca is

An **ADE — Agent Development Environment**. Pitch: *"Run Codex, ClaudeCode, OpenCode or
Pi side-by-side, each in its own worktree, tracked in one place."*

Its mental model: **the git worktree is both the unit of isolation and the unit of UI.**
A worktree isn't just a checkout — it's a checkout plus its terminals (running agents),
its browser tabs, its editor tabs, its diff, and its card metadata.

### Orca's UI, described

- **Left sidebar = the fleet dashboard.** Repos expand into worktrees. Each worktree card
  shows its name, **inline coloured dots for every running agent** (green pulsing =
  working, yellow = waiting on input, grey = idle), a one-line **checkpoint comment the
  agent itself wrote**, PR/CI state (red for failing checks), and unread state.
  Groupable by repo, by parent/child lineage, or by PR status. Unnamed worktrees are
  auto-named after marine creatures.
- **Workspace Board** — a kanban drawer rendering worktrees as cards in status lanes
  (To do / In progress / In review / Done, customisable). Drag between lanes, multi-select
  drag, resizable columns, and a separate "Pinned" drop target so pinning and status are
  independent axes sharing one gesture.
- **Main area = tabs and panes.** Each tab holds exactly one thing: a terminal, an editor
  buffer, a browser, a diff, or a PR. Drag a tab to a pane edge to split; splits nest; any
  tab type can split with any other. **Pane layout is persisted per worktree** — switching
  worktrees restores that worktree's exact layout.
- **Palettes**: `Cmd-P` for files, `Cmd-J` for a jump palette across all worktrees, tabs
  and projects (`Shift-Enter` opens in a new split; typing a non-matching name offers to
  *create* that worktree).
- **Agents feed / Activity page** — a threaded catch-up surface across all worktrees, with
  a preview of each agent's most recent response so you can skim without opening threads.
- Status bar with agent usage/rate-limit meters; notification bell with unread count.

### The ideas worth stealing, ranked

1. **Line-anchored diff annotations, batched into one prompt.** Comment on the agent's
   diff like a colleague's PR; one button packages *every unresolved comment* into a
   single prompt with line references and sends it to the agent. Their stated rationale is
   the real insight: sending comments one at a time makes the agent swing back and forth,
   because each turn sees only a fragment of what's wrong.
2. **AI attribution gutter.** Record which line ranges the agent authored; mark them in the
   diff; flip back to "human" the moment a human edits them. Local only, never committed.
   Turns "review this 800-line diff" into "review the 200 lines it actually wrote."
3. **Worktree checkpoints.** One line of free text per worktree, *written by the agent*.
   Absurdly cheap, and it converts a wall of branches into a scannable board.
4. **A self-describing CLI.** `orca agent-context --json` publishes a machine-readable
   schema of all ~200 commands — flags, examples, and prose guardrails — so agents
   *discover* the API instead of guessing. Shipped to agents as an installable Skill
   rather than an MCP server.
5. **Agent state via OSC terminal title sequences** — zero per-agent SDK work; this is how
   they support 40+ agents cheaply.
6. **Lineage ≠ git base branch.** Orca separates the *organisational* parent/child worktree
   relation from the *git* base ref, and hammers the distinction. Most tools conflate them.

### What Blackfin deliberately does NOT copy

Orca is an IDE. Bolting a terminal multiplexer, a Monaco editor, and an embedded Chromium
onto a git client is not an enhancement — **it is a rewrite, and it would arrive second.**

Blackfin's asset is the inverse: **it is already an excellent desktop git client.** The
diff viewer, partial staging, history, branch and PR flows are mature and trusted.

> **Blackfin is the control center *where the git already is*.**
> Every feature must graft onto a surface the app already owns.

Blackfin does not host agents. It observes and organises their *work product* and their
*context*. If a proposal requires Blackfin to spawn or supervise a running agent process,
it is probably the wrong proposal.

---

## 4. What is built and working today

### Navigation — the app's frame

A **persistent left rail** is the primary navigation. This is load-bearing: the git client
is *one destination*, not the frame the others live inside.

```
┌──┬──────────────────────────────────┐
│◉ │  HOME                            │   Home    — command center; the app opens here
│  │                                  │   Code    — the ENTIRE git client, unchanged
│⌥ │  12 projects · 3 with no context │   Agents  — agent context, Global + Project scopes
│  │  8.4 GB reclaimable              │   Docs    — documentation across all projects
│✦ │  5 broken references             │   Disk    — reclaimable build artifacts
│  │                                  │
│▤ │  [ project cards … ]             │   The git toolbar renders ONLY in Code.
└──┴──────────────────────────────────┘
```

- `app/src/models/app-section.ts` — the `AppSection` enum
- `app/src/ui/rail/app-rail.tsx`
- `app/src/ui/home/home-view.tsx`
- `app/src/ui/workspace/` — the cross-project views

### The Workspace inventory

Scans every project and reports three things:

- **Agent context** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `KIMI.md`, `.cursorrules`,
  `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules`,
  `.goosehints`, `CONVENTIONS.md`, plus the contents of `.claude/`, `.codex/`, `.cursor/`,
  `.gemini/`, `.opencode/`, `.antigravity/`, `.kimi/`, `.windsurf/`, `.continue/`,
  `.agents/`. Each file is classified by **agent** (Claude Code, Codex, Cursor, Copilot,
  Gemini, OpenCode, Antigravity, Kimi, Windsurf, Aider, Cline, Goose, Continue, or the
  shared `AGENTS.md` convention — which belongs to *no single agent*) and by **role**
  (Instructions, Skill, Command, Subagent, Prompt, Settings, Hook).
- **Documentation** — READMEs, `docs/**`.
- **Reclaimable disk** — `node_modules`, `dist`, `.next`, `target`, `__pycache__`, `.venv`,
  `.turbo`, coverage, caches — measured recursively, sorted biggest-first, deletable to
  the trash.

Two scopes, shown as tabs under **Agents**:

- **Project** — inside a repository. Applies to that project only.
- **Global** — the user's home directory (`~/.claude`, `~/.codex`, …). **Applies to every
  project on the machine and is invisible from inside all of them.** This is the screen
  nothing else in the toolchain gives you: when an agent surprises you in one project, the
  cause is often a file that project has never heard of.

Signals it surfaces, in priority order:

1. **Projects with no agent context at all** — nothing steers what gets written there.
2. **Broken references** — a `CLAUDE.md` `@import` or relative link pointing at a file that
   no longer exists. Every reference is resolved against the filesystem.
3. Skills/commands/subagents with their `name` and `description` read from frontmatter.

### Folder discovery

"Add folder…" on Home opens a native directory picker, then finds every git repository
inside it (depth-limited, skipping build artifacts). It recognises **linked worktrees**,
whose `.git` is a *file* rather than a directory.

### Code layout (all new code)

```
app/src/models/
  workspace-inventory.ts      types: AgentId, ContextRole, ContextScope, ArtifactKind…
  app-section.ts              the rail's destinations

app/src/lib/workspace/
  catalog.ts                  PURE. classify a path → {agent, role} or artifact kind
  parse.ts                    PURE. headings, rules, @imports, frontmatter. Never throws.
  context-file-reader.ts      I/O. read + parse one context file; resolve references
  scan.ts                     I/O. walk a repository
  scan-global.ts              I/O. walk the user's home agent dirs
  discover-repositories.ts    I/O. find git repos inside a folder
  cleanup.ts                  I/O. delete artifacts, paranoid (see below)

app/src/lib/databases/workspace-database.ts   Dexie cache (standalone DB)
app/src/lib/stores/workspace-store.ts         cache + concurrent scan + progress

app/src/ui/workspace/         split by responsibility, not one big file:
  workspace-center.tsx        the shell: header, scope tabs, filter
  repository-row.tsx          one project, expandable
  context-file-list.tsx       context files grouped by agent
  doc-file-list.tsx
  artifact-list.tsx
  global-context-panel.tsx
  display.ts                  PURE. display names
```

**The governing rule: all parsing and classification is pure and has no I/O.** That is
where the complexity lives, so that is where the tests live. ~90 tests cover it.

### Safety, because one feature deletes data

Cleanup is deliberately paranoid, and any change to it must stay that way:

- `dist/`, `build/`, `out/`, `target/` are only treated as build output **if a manifest
  (`package.json`, `Cargo.toml`) sits beside them.** Someone's hand-written `dist/` must
  never be offered for deletion.
- **Symlinks are never followed.** A symlinked `node_modules` would otherwise be followed
  to its target — that is how a tool like this eats someone's home directory.
- Every deletion **re-classifies from scratch at the moment of deletion**, rather than
  trusting an inventory that may be minutes stale.
- Deletion goes to the **trash**, not `rm -rf`.
- A refusal or failure is an *outcome*, never an exception — a cleanup across twenty
  projects must not abandon nineteen because one directory was locked.

---

## 5. Load-bearing facts about the existing codebase

**Read this before designing anything. Each of these has already changed a design.**

### ✅ Things that already exist (do not rebuild them)

| | |
|---|---|
| **A working agent integration** | The fork ships **GitHub Copilot CLI over stdio** via `@github/copilot-sdk`, re-execing Electron as Node. `CopilotStore.createClient()` (`app/src/lib/stores/copilot-store.ts:728`), `runConflictResolutionTurn()` (`:529`) is a reusable streaming-turn driver, and `CopilotFeature` (`:108`) is a feature registry that gives model selection and BYOK nearly free. **"Send this to an agent" is not a new integration — it is a second serializer plus a third enum member.** |
| **Prompt serialization precedent** | `copilot-conflict-context.ts:380` `formatConflictContextForPrompt()` already does "gather structured context → emit one markdown prompt", with `makeFencedBlock()` (`:507`) computing fence length dynamically so backticks can't escape, and untrusted content wrapped in delimiter tags (`copilot-store.ts:249`). |
| **Real git worktree support** | `app/src/lib/git/worktree.ts` (list/add/remove/move), add/rename/delete dialogs, a toolbar dropdown, and `.worktreeinclude` (`worktree-include.ts:120`) which copies your `.env` into new worktrees. **Worktrees are NOT separate `Repository` rows** — switching mutates the existing row's `path` (`repositories-store.ts:524`); `gitDir` is the stable anchor. |
| **Markdown rendering** | `SandboxedMarkdown` (`app/src/ui/lib/sandboxed-markdown.tsx:69`), renders into a sandboxed iframe. |
| **Autocompleting textarea** | `app/src/ui/autocompletion/` — brings `:emoji`, `@user`, `#issue` completion free. |
| **A third repo tab already exists** | Commit `0bf9b45832` added a "Compare" tab — it is the exact 10-file template for touching the tab machinery. |

### ⛔ Things that are structurally blocked (budget for them)

| | |
|---|---|
| **No seam for Linear/Jira** | `Account.computeApiType()` (`account.ts:157`) derives the provider **from the endpoint URL**, and every consumer resolves an account **from a git repository**. Linear and Jira are not git forges — they have no repo, no clone URL. `getAccountForRepository` can *never* return a Linear account, and a Linear endpoint would be classified as GitHub Enterprise Server. **A parallel `TaskProvider` abstraction is required.** |
| **No GraphQL infrastructure** | Exactly **one** GraphQL call exists in the whole codebase (`api.ts:2855`), a raw template-literal POST. No client, no codegen, no typed schema. **GitHub Projects v2 and Linear are GraphQL-only.** |
| **PR state is not persisted** | `pull-request-database.ts` stores no `state` field; the store tracks **only open PRs**. A kanban lane meaning "merged" or "in review" **cannot be derived today** without extending both the API fetch and the schema. |
| **Diff line indices are unstable** | Diff selection is keyed on `diffLineNumber` = `hunk.unifiedDiffStart + n`. **Expanding a hunk rebuilds the diff and shifts every subsequent index** (`text-diff-expansion.ts:219`). Annotation anchors must be stored as `(path, old/newLineNumber, content-hash)` — never as a line index. An anchor that silently slides onto the wrong line destroys trust in a review tool. |
| **The diff renderer is a custom virtualized React list** | Not CodeMirror (which is present but used only as a web-worker tokenizer). `side-by-side-diff.tsx` + `side-by-side-diff-row.tsx`, `react-virtualized` + `CellMeasurer`. Variable-height inline widgets work — **but you must invalidate the height cache** (`clearListRowsHeightCache()`, `:683`). |
| **No drawer primitive** | Only dialogs (`PopupType`), foldouts (`FoldoutType`), and popovers (`ui/lib/popover.tsx:103`). A drawer must be built. |
| **The issues schema is a stub** | `IIssue` is four fields; `IssuesStore` exists solely to feed `#123` autocomplete. There is no issue list UI anywhere. |
| **Check-run log text is never downloaded** | Despite its name, `getLatestPRWorkflowRunsLogsForCheckRun()` fetches job *step metadata*. Handing failing checks to an agent means handing it names and URLs, not logs. |

---

## 6. Specs already written

In `docs/superpowers/specs/`. Each has a design doc; the first also has an issue-sized
task breakdown.

| Spec | State |
|---|---|
| **Agent Context** | Approved and **now implemented** (superseded in scope by the Workspace) |
| **Tasks** — GitHub Projects/Issues, Linear, Jira; branch-from-card; status sync | Drafted. Phased A–E; do **not** start at Projects v2. |
| **Worktrees + Fleet Board** — lineage, agent checkpoints, kanban | Drafted |
| **AI Attribution** — line-range authorship in the diff gutter | Drafted |
| **Diff Annotations** — comment → batch → send to agent | Drafted |
| **Project Overview** — GitHub-style repo landing (README, last commit, contribution graph) | Sketched |
| **A self-describing `blackfin` CLI** | **Not specced. The most important gap.** |

### The CLI gap — read this

Several features above degrade to read-only dashboards without a surface an agent can
*call*:

- The agent never writes its own worktree **checkpoint**.
- The agent never declares the **line ranges it authored** (so attribution must fall back
  to inference).
- The agent never asks the app to **show the human a diff**.

Orca's answer — publish a machine-readable schema of your own operations, ship it to
agents as a Skill — is the highest-leverage idea in that entire product. Any roadmap that
ignores it produces a beautiful panel that agents cannot participate in.

---

## 7. Conventions you must follow

- **Stack**: Electron + React (class components, not hooks — match the surrounding code) +
  TypeScript, strict. SCSS with CSS custom properties (`var(--text-secondary-color)` etc.);
  **every screen must work in light and dark themes**.
- **Lint rules that will reject your code**:
  - `react/jsx-no-bind` — **no arrow functions in JSX props.** Extract a subcomponent with
    a bound handler.
  - `github/a11y-no-title-attribute` — **no `title` attribute.** Use `aria-label`.
  - Prettier is enforced.
- **Tests**: `node:test` + `tsx`, in `app/test/unit/*-test.ts`. `fake-indexeddb` is set up
  globally, so Dexie works in tests. Suite: **1602 tests, 0 failures — keep it that way.**
- **Full-screen views** use the `<UiView>` wrapper (`app/src/ui/ui-view.tsx`).
- **Dexie**: new caches get a **standalone database**, not a new table on
  `repositories-database` — a cache is not worth a schema migration on the data it caches.
- **Verify honestly.** Run `npx tsc --noEmit -p tsconfig.json` (note: **not**
  `app/tsconfig.json`, which does not exist), `yarn test:unit`, and eslint. Do not claim a
  check passed without its output.

Build and run: `yarn build:dev` then `yarn start`.

---

## 8. What we want from you

The user will define the tasks. Your job is to give them the material to do it well.

The user considers **Orca's visual interface exemplary** and wants Blackfin to reach that
bar. Blackfin's current UI is functional and honest but visually plain — it inherits
GitHub Desktop's chrome. The gap between "a working control center" and "a control center
someone wants to look at all day" is the interesting one.

So: propose, with reasoning and trade-offs, and grounded in §5 —

1. **What Blackfin should look like.** Not a reskin: an information architecture and a
   visual language for a control center whose subject is *agents and their context*, built
   on the surfaces this app already owns. Say specifically what you would take from Orca's
   sidebar/board/pane model and what you would reject, and why.
2. **What to build next, in what order**, and what each thing costs given §5.
3. **Where the current design is wrong.** Argue with it. Say so plainly.

Be concrete, cite files, and do not propose anything that requires Blackfin to host a
running agent process — that is Orca's product, and building it here means rewriting the
app.
