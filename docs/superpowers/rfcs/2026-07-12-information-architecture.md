# RFC — The rail's destinations and what each one owns

- **Date:** 2026-07-12
- **Issue:** [#15](https://github.com/matbrgz/blackfin/issues/15) — *RFC: The rail's destinations and what each one owns*
- **Status:** Proposal. Awaiting maintainer ratification of **D1** (the destination criterion) and **D2** (orthogonality). See §12.
- **Depends on:** [#10](https://github.com/matbrgz/blackfin/issues/10) — *taxonomy* (`docs/superpowers/rfcs/2026-07-12-taxonomy.md`), [#11](https://github.com/matbrgz/blackfin/issues/11) — *extension domain model* (**RATIFIED**), [#13](https://github.com/matbrgz/blackfin/issues/13) — *marketplace architecture* (**RATIFIED**). This document places nouns those RFCs already defined; where they disagree with this one, **they win**.
- **Blocks:** [#16](https://github.com/matbrgz/blackfin/issues/16) (the name of the Agents section), [#19](https://github.com/matbrgz/blackfin/issues/19) (empty/loading/error as a system), [#20](https://github.com/matbrgz/blackfin/issues/20) (keyboard navigation and focus), and every future domain that would otherwise arrive asking for a rail slot.
- **Scope of this document:** the criterion that decides what is a destination, the destination set that follows from it, what each destination owns, the scope model and where the scope selector lives, and what survives a restart. **No production code.** Visual tokens are #17, components are #18, state systems are #19, focus is #20, the label on the third destination is #16.

---

## 1. Problem

The rail has five destinations (`app/src/ui/rail/app-rail.tsx:58-64`), and the enum behind
them (`app/src/models/app-section.ts`) carries a comment that states the product thesis
plainly:

> `Code` — the entire git client, sidebar and diff and history and all — is *one* of these,
> not the frame the others hang off.

That is the right thesis and the code honours it. What the code does **not** have is a rule
for what earns a sixth slot. The backlog is holding four domains with nowhere to live —
extensions (#35, #36, #40, #41), the marketplace (#47–#54), the fleet (M4), review
intelligence (M6), tasks (M7) — and every one of them will arrive as a pull request that adds
a line to `Destinations` and a member to `AppSection`. Five destinations chosen by taste is a
design. Nine destinations chosen one pull request at a time is a menu.

The list matters less than the criterion. A criterion answers *"where does the marketplace
go?"* without reopening this document; a list has to be reopened every time.

And there is a second, sharper problem, which the code makes concrete. The rail has two
controls — a **destination** picker and a **project-scope** picker (`app-rail.tsx:243-286`) —
and they are wired to each other in a way that makes the promise in the issue impossible:

```ts
// app/src/ui/dispatcher/dispatcher.ts:376-382
public selectRepository(repository, persistSelection = true) {
  this.appStore._setAppSection(AppSection.Code)     // ← picking a project moves you to Code
  return this.appStore._selectRepository(repository, persistSelection)
}
```

```ts
// app/src/ui/app.tsx:3506-3518
private onSelectRailScope = (project) => {
  if (project === null) {
    this.props.dispatcher.setAppSection(AppSection.Home)   // ← "All projects" moves you to Home
  } else {
    this.props.dispatcher.selectRepository(project)        // ← and any project moves you to Code
  }
}
```

So *"I am in `project-a` under Code, I go to Agents, and I stay in `project-a`"* — the
continuity requirement stated in the issue — is not merely unimplemented. Choosing the scope
**is** choosing the destination. The user cannot express "this project, that lens", because
the two axes are one control wearing two hats.

Third: nothing about where the user was survives a restart. `selectedAppSection` is a private
field initialised to `Home` (`app/src/lib/stores/app-store.ts:840`) and `_setAppSection`
(`:1354-1363`) never writes it anywhere. The repository selection *is* persisted
(`LastSelectedRepositoryIDKey`, `app-store.ts:477`). The result is an app that remembers
which project you were in and forgets what you were doing with it.

Fourth, and quietly: the scope selector does not scope anything except Code.
`renderWorkspaceCenter` (`app/src/ui/app.tsx:4297-4304`) passes `this.workspaceRepositories()`
— every project, always — regardless of what the selector says. Agents, Docs and Disk ignore
the control sitting directly above them.

## 2. Why it matters

The rail is the only part of this app that every feature has to negotiate with. Getting it
wrong is not a visual cost:

- **A destination is a permanent claim on attention.** Every slot dilutes every other slot,
  and the rail is 68px wide. Adding is easy and removing is a migration of user habit.
- **Coupling scope to destination makes the product's differentiating screen unreachable.**
  The issue names it: *"what is steering **all** my projects that I cannot see from inside any
  one of them?"* That screen is a destination at global scope. If picking global scope throws
  you to Home, the screen exists but cannot be navigated to on purpose.
- **#19 and #20 cannot be written against an unknown set.** An empty-state system needs to
  know how many empties there are and what each one means; a focus model needs to know what
  the tab ring contains. Both issues are labelled `status:blocked`, and this is what blocks
  them.
- **#16 cannot be answered without a noun.** "Is *Agents* the right name?" is unanswerable
  until it is settled what that destination *owns*. Naming is downstream of ownership.

## 3. Current state (grounding)

**The destinations.** `AppSection` (`app/src/models/app-section.ts:9-21`) —
`Home | Code | Agents | Docs | Disk`, plus `isWorkspaceSection` (`:23-30`), which groups
`Agents | Docs | Disk` as "sections that render the cross-project workspace, and the lens each
uses". That helper is already the seed of the criterion this RFC formalises: three of the five
are the *same view* under different lenses.

**The rail.** `Destinations` (`app-rail.tsx:58-64`) is a flat literal array of
`{ section, label, icon }`. The rail also renders an attention badge on Home (`:305`) and, at
the top, the project-scope selector (`:243-286`) — a `SectionFilterList` in a popover, whose
items are the repositories plus a synthetic `AllProjectsItemId` row (`:25`).

**The routing.** `renderSection` (`app/src/ui/app.tsx:3542-3558`) is an exhaustive switch with
`assertNever`. `Home → renderHome`, `Code → renderRepository`, and the other three collapse
into `renderWorkspaceCenter(section)` (`:4297-4304`), which receives the section as a lens
parameter. The exhaustiveness is a virtue and this RFC preserves it: a new destination cannot
be added without the compiler pointing at every place that must handle it.

**The scope.** There is no scope state. What plays the role of scope is
`selectedState.repository` — the git client's repository selection — read back by the rail as
`scopedProject`. `selectRepository` persists it (`LastSelectedRepositoryIDKey`,
`app-store.ts:477`) and forces `AppSection.Code` (`dispatcher.ts:380`). The doc comment above
that method (`dispatcher.ts:366-375`) explains the forcing as deliberate — a user who picks a
repository from a list expects to land on it — and it also records the exception:
launch-time restoration bypasses the dispatcher precisely so restoring a repository does not
yank the user to Code. That exception is evidence that the coupling was already understood as
a problem in the one case where it visibly hurt.

**Persistence.** Persisted today: last repository, recent repositories
(`RecentRepositoriesKey`, `:486`), and a long tail of view preferences (`showWorktreesKey`,
`showCompareTabKey`, …). **Not persisted:** the destination, the scope-as-such, any filter
text, any expansion state in the workspace sections.

**Primitives available.** Dialogs (`PopupType`), foldouts (`FoldoutType`), popovers
(`app/src/ui/lib/popover.tsx`), `SectionFilterList` (`app/src/ui/lib/section-filter-list.tsx`),
`DetailPane` (`app/src/ui/lib/detail-pane.tsx`). **There is no drawer primitive**
(`docs/BRIEFING.md:272`), and `detail-pane.tsx:37-39` records why one was not built:

> Deliberately not a drawer. The detail is where the user settles, and a control center exists
> to *compare across projects*; a modal drawer would […]

Any information architecture proposed here that requires a drawer is proposing an unbudgeted
component. This one does not.

## 4. The criterion (the actual deliverable)

> **A rail destination is a noun Blackfin can enumerate across every project, that the user
> returns to with a standing question, and whose items they act on in place.**
>
> **Everything else is a lens: a filter, tab, or mode _inside_ a destination — including
> things that feel big.**

Three tests, and a candidate must pass **all three**:

1. **Enumerable across projects.** Blackfin can produce the full list without the user first
   choosing where to look. This is the test that separates a destination from a detail view.
2. **A standing question.** The user arrives already knowing what they want to know, and the
   question recurs. "What did I install and what can it do?" recurs. "What does this one file
   say?" does not — that is a detail, reached from a list.
3. **Acted on in place.** The destination is where the verbs live (install, disable, delete,
   check out, open). A screen that only forwards elsewhere is a lens on the thing it forwards
   to.

And one veto, which exists because the rail's slots are the scarcest surface in the product:

> **Same noun, same destination.** Two screens that operate on the same noun are one
> destination with two modes, no matter how different their pixels are. The rail lists nouns,
> not activities.

The veto is what answers the marketplace question, so it is worth being explicit that it is
doing real work and not just tidying: browsing a marketplace and reviewing what is installed
are *very* different activities, and they are the same noun — an Extension (#10 §5.1). One
destination, two modes.

## 5. The destination set that follows

Applying the criterion to everything the backlog holds:

| Candidate | Enumerable | Standing question | Acted on in place | Same-noun veto | Verdict |
|---|---|---|---|---|---|
| **Home** | — | "What needs my attention?" | forwards | — | **Destination** (special, §5.1) |
| **Code** | yes (one at a time) | "What am I changing?" | yes | — | **Destination** |
| **Agents** (name = #16) | yes | "What is steering my agents?" | yes | — | **Destination** |
| **Docs** | yes | "What documentation exists?" | yes | — | **Destination** |
| **Disk** | yes | "What can I reclaim?" | yes | — | **Destination** |
| **Fleet** (M4) | yes | "What are my agents doing?" | yes | — | **Destination**, reserved |
| **Tasks** (M7) | yes | "What am I meant to be doing?" | yes | — | **Destination**, reserved |
| Marketplace (M3) | yes | "What could I install?" | yes | **vetoed** — noun is Extension | **Mode inside Agents** |
| Extensions (M2) | yes | "What is installed?" | yes | **vetoed** — noun is Extension | **It _is_ Agents** (§5.3) |
| Review (M6) | yes | "What needs reviewing?" | yes | **vetoed** — noun is a change | **Lens in Code + rows in Home** |
| Settings | yes | recurs, but rarely | yes | — | **Not a destination** (§5.7) |
| Command palette (#33) | no | — | — | — | **Not a destination** — it is a way *to* destinations |

Five destinations today; two reserved slots with names already earned; **seven at the
ceiling**. The rail does not grow past that without a new RFC, and this table is the reason a
new RFC would be required rather than a pull request.

### 5.1 Home — the exception, and why it is allowed

Home fails test 3: it forwards rather than acts. It is a destination anyway, for one reason
that the criterion cannot express: **it is the only screen that is about the union of the
others**. Its noun is not a thing on disk, it is *attention* — and attention is by definition
cross-cutting.

- **Owns:** the attention queue. Nothing is stored here; everything shown is derived from
  another destination's items.
- **Shows:** what is wrong or waiting — projects with no agent context at all, instructions
  referencing files that no longer exist (`app/src/ui/app.tsx:3520-3540`, `attentionCount`),
  and, as later milestones land, orphaned extension records (#25), failed runs (M4), review
  requests (M6).
- **Does not show:** anything that is merely *present*. Home is not a dashboard of counts. If
  nothing is wrong, Home is not a wall of green tiles.
- **Empty:** the good empty. "Nothing needs your attention" is a success state and must read
  as one, not as a missing-data state. This distinction is #19's to systematise; naming it
  here is what makes it a requirement rather than a nicety.

### 5.2 Code — the git client, untouched

- **Owns:** the working tree of exactly one repository — changes, history, branches, diffs.
- **Shows:** what upstream GitHub Desktop shows. Unchanged.
- **Does not show:** anything cross-project. Code is the one destination that is *narrower*
  than the app.
- **Empty:** no project in scope → the project picker, which is what the app already shows
  when nothing is selected.
- **Note:** this is the destination that declares a **required scope** (§7.2). It is also the
  reason scope exists at all.

### 5.3 The third destination — the steering context

This is the destination the backlog has been circling, and the criterion collapses three
proposed screens into it:

- **Owns:** the **Extension** and its **Capabilities** — the ratified nouns of #10 §5.1–5.2 —
  at every scope, from every agent, whatever their `source` (#11 §5.3: `detected` included).
- **Shows:** what is steering agents right now, and everything the user can do about it —
  what exists, where it came from, what it can reach (#12 §7), whether it is enabled, whether
  it is outdated, and — in **Browse** mode — what could be installed but is not (#13).
- **Does not show:** documentation that steers nobody (that is Docs), and settings files that
  are not extensions. Per #11 §5.1, `ContextRole.Settings` remains a *source* of MCP
  declarations, not a catalog item.
- **Empty:** no agent configuration anywhere is not an error — it is the honest answer for a
  machine with no agents installed, and `scan-global.ts:78` already takes that position in
  code (*"The agent simply isn't installed. That's not an error, it's an answer."*). The
  empty state teaches: this is what a `SKILL.md` is, this is where it goes.
- **Modes (lenses, not destinations):** **Installed** (default) and **Browse** (the
  marketplace, #48/#49). One noun, two modes, one slot. When M3 lands, it lands here.
- **Name:** deliberately not decided. That is #16, and #16 now has what it was waiting for —
  the noun. The label must name *Extension + Capability*; "Agents" names the consumers of
  those things, which is why the question was asked in the first place.

### 5.4 Docs — documentation across every project

- **Owns:** documentation files: `README`, `docs/**`, `CONTRIBUTING`, ADRs.
- **Shows:** what exists, where, how stale, and what it links to that is gone.
- **Does not show:** agent instructions. A `CLAUDE.md` is steering, not documentation, and per
  #11 §5.1 `ContextRole.Instructions` stays a context file rather than becoming an extension —
  it belongs to §5.3, not here.
- **Empty:** a project with no docs is a finding, not a blank.

### 5.5 Disk — reclaimable space

- **Owns:** build artifacts and caches — `node_modules`, `target`, `dist`, `.venv`.
- **Shows:** size, age, and whether removal is safe, with the guarantees `cleanup.ts:64-152`
  already implements (path containment, refuses to follow symlinks, reclassifies at the moment
  of deletion, trash rather than `rm -rf`).
- **Does not show:** anything it would not offer to delete.
- **Empty:** nothing to reclaim. Also a success state.

### 5.6 Reserved: Fleet (M4) and Tasks (M7)

Both pass all three tests and neither is vetoed; both are **reserved, not built**. Recording
them now is the point of having a criterion — it means M4 and M7 do not each reopen this
document to argue for a slot.

- **Fleet** owns the worktree and the run: which agent is working where, on what, since when.
  The noun exists in code already (`app/src/lib/git/worktree.ts`), and #11 §5.2 has already
  admitted `worktree` into the scope enum, so the scope model below does not have to change to
  accommodate it.
- **Tasks** owns the task, across providers (`TaskProvider`, #75, shipped). It is distinct
  from Home: Home is what is *wrong*, Tasks is what is *chosen*.

### 5.7 Not a destination: Settings

Settings is enumerable, is acted on in place, and is a standing question — but it is a
standing question about *Blackfin*, not about the user's work. It stays where it is (the
preferences dialog, `PopupType.Preferences`). Recorded here because a rail with an empty slot
attracts a gear icon, and this is the answer when it does.

## 6. Rail and scope are orthogonal — D2

Two axes:

- **Destination (what):** one of the seven. Answers *"what am I looking at?"*
- **Scope (where):** global, a project, or (M4) a worktree. Answers *"across what?"*

Every cell in that grid is a legal screen, and the coupling described in §1 is a defect
against this model, not a feature of it. The three concrete defects:

| Where | What it does now | Under this RFC |
|---|---|---|
| `dispatcher.ts:380` | `selectRepository` forces `AppSection.Code` | Scope change **never** changes destination |
| `app.tsx:3510` | scope `null` forces `AppSection.Home` | Global scope is legal at any destination |
| `app.tsx:4297-4304` | workspace sections ignore scope entirely | Every destination reads the scope |

There is one honest complication, and hiding it would be the mistake. `selectRepository`
forcing Code is not arbitrary: when the user picks a repository from the *repository list*
inside Code, landing on it is correct behaviour, and the doc comment at `dispatcher.ts:366-375`
argues exactly that. The resolution is not to delete the forcing but to **separate the two
callers**:

- Picking a repository from **Code's repository list** is a Code-local action. It sets scope
  *and* asserts the destination, because the control lives inside the destination it asserts.
- Picking a project from the **rail's scope selector** sets scope *only*. The control lives
  outside every destination; it must not choose one.

Same store method, two dispatcher entry points, one of which does not touch the section.
That is the whole implementation of D2, and it is why this RFC can claim orthogonality
without proposing a rewrite.

### 6.1 The continuity test

The issue's requirement, restated as a test that #20 and the implementation issue can both
execute:

> Scope `project-a`, destination Code. Switch to the third destination. **Scope is still
> `project-a`.** Switch back to Code. **The repository, the tab, and the diff are as they
> were.**

And its mirror, the one that makes the product's distinguishing screen reachable:

> Destination = the third one, scope = global. **The screen shows every agent context on the
> machine**, and getting there took one click on the scope selector — not a trip through Home.

## 7. The scope model

### 7.1 Three levels, one of them not yet built

`global ⊃ project ⊃ worktree`. This is the same ladder #11 §5.2 ratified for
`ExtensionScope`, and using one ladder for both is deliberate: the thing the user selects and
the thing an extension is scoped to are the same concept, and letting them drift would mean
translating between two nearly-identical enums forever.

`worktree` is **reserved, not shipped**. The requirement it imposes on the design today is
only this: the selector must be able to grow a level without being redesigned. That is why it
is specified as a **path** (`global` → project → worktree) rather than a flat list of
projects — a flat list has nowhere to put the third level.

### 7.2 Required scope, and what "no project" means

Scope is orthogonal, but a destination may declare a **minimum**:

| Destination | Minimum scope | Global scope means |
|---|---|---|
| Home | none | across every project (the default) |
| Code | **project** | not selected → the project picker |
| Third destination / Docs / Disk | none | across every project — *the differentiating view* |
| Fleet (M4) | none | every worktree, every project |
| Tasks (M7) | none | every provider, every project |

Code declaring a minimum is not an exception to orthogonality — it is a property of the
destination, evaluated at render, exactly as an empty state is. The user is never blocked from
choosing a cell; they are shown what that cell contains, and for `Code × global` what it
contains is "pick one".

### 7.3 Where the selector lives

**In the rail, above the destinations** — where it already is (`app-rail.tsx:243-286`).

It is app-global (one scope, not one per destination) and it sits above the destination list
because it qualifies all of them. Two rejected alternatives, recorded so they are not
relitigated:

- **Per-destination scope.** Each destination remembers its own project. Rejected: it breaks
  §6.1 by construction — that is the current behaviour's failure mode in a nicer costume.
- **Scope in the toolbar.** The toolbar belongs to Code (`renderToolbar`, `app.tsx:4202`).
  Putting an app-global control inside a destination-local surface is the coupling of §6
  reintroduced through layout.

## 8. What persists

| State | Persists | Why |
|---|---|---|
| Destination | **yes** | *"Where was I?"* — the issue's last continuity question, and the one the app answers worst today |
| Scope | **yes** | Already does, as `LastSelectedRepositoryIDKey` (`app-store.ts:477`); this RFC only renames the concept |
| Code's internals (repo, tab, diff) | yes, unchanged | Upstream behaviour |
| Expansion state per destination | **yes** | Cheap, and its absence is felt on every return |
| Filter text | **no** | A filter is a question being asked now. Restoring one shows a filtered list that looks like a short list — an empty state that lies |
| Scroll position | **no** | Restoring scroll into a list rebuilt from a rescan lands somewhere arbitrary |

**Mechanism:** `localStorage`, following every existing key in `app-store.ts:477-633`. No new
database. Two keys: the destination and the scope. This is view state — losing it costs one
click, so it is explicitly *not* the tier-2 Blackfin metadata that #14 is about, and it must
not end up in the same store.

**One consequence to handle deliberately.** `dispatcher.ts:371-374` records that launch-time
restoration bypasses the dispatcher so that restoring the last repository does not yank the
user to Code. Once the destination is persisted, that workaround is no longer needed — restore
both, independently, and the user lands exactly where they left. The comment is then wrong and
should be removed with the code it defends, not left behind to confuse the next reader.

## 9. Options considered

### Option A — Keep five, add one destination per new domain

Home, Code, Agents, Docs, Disk + Extensions + Marketplace + Fleet + Review + Tasks.

- **For:** every domain is one click away; no mode-switching inside a destination.
- **Against:** ten destinations in a 68px rail, with no criterion — so the eleventh is another
  argument. And it puts Extensions and Marketplace in separate slots while they operate on the
  same noun, which guarantees the question *"why is the thing I installed not in the place I
  installed it from?"*

### Option B — Two destinations (Code, Everything Else) with the rest as tabs

- **For:** minimal rail; every cross-project view lives under one roof.
- **Against:** it re-frames the app as a git client with an annex, contradicting the thesis in
  `app-section.ts:1-8`. "Everything Else" is not a noun and cannot have an empty state.

### Option C — Criterion-driven: five now, seven at the ceiling, modes for same-noun screens

What §4 and §5 describe.

- **For:** the rail stays legible; the marketplace question is answered without a slot;
  new domains are tested rather than negotiated; nothing shipped has to be rebuilt.
- **Against:** Browse-vs-Installed as a mode is one extra click for a user who arrives wanting
  to shop, and the mode control has to be genuinely visible or it becomes a hidden feature.
  This is a real cost, and it is #48/#49's problem to solve well.

### Recommendation

**Option C**, with **D2 (orthogonal axes)** as the change that makes it worth anything. Option
C without D2 is a tidier list attached to the same broken navigation.

## 10. The user-facing test

From the issue, restated as checks that can actually be run:

| The user asks | Answer | Passes today? |
|---|---|---|
| "What needs my attention?" | Home | yes |
| "What is steering the agent in **this** project?" | third destination, scope = project | **no** — scope does not reach it (`app.tsx:4297-4304`) |
| "What is steering **all** my projects?" | third destination, scope = global | **no** — global scope forces Home (`app.tsx:3510`) |
| "What did I install, from where, and what can it do?" | third destination, Installed mode | not yet built (M2) |
| "What are my agents doing across four branches?" | Fleet | not yet built (M4) |
| "Where was I?" | exactly where they were | **no** — destination is not persisted (`app-store.ts:840`) |

Three of six are failures against code that exists today. They are the acceptance criteria for
the implementation issue this RFC calls for.

## 11. What this RFC does not decide

- **The label on the third destination.** #16. It now has its input: the noun is Extension +
  Capability.
- **Empty, loading, skeleton, error as a system.** #19. This document names *what empty means*
  per destination; the system that renders those meanings is that issue's.
- **Keyboard navigation and focus.** #20. The structure is now fixed: two axes, seven maximum
  destinations, one app-global scope control above the list. That is the tab ring #20 needs.
- **Tokens, density, typography** (#17) and **components** (#18).
- **The command palette** (#33) — a way to destinations, not one of them.
- **Redesigning the git client.** Code is upstream's, unchanged.
- **Anything about Orca.** Conceptual reference only; no code, no assets, no identity.

## 12. Decision register

| # | Decision | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| D1 | The criterion (§4): enumerable + standing question + acted-on-in-place, with the same-noun veto | **Adopt.** It is what makes the marketplace answerable without a slot | @matbrgz | #16, #19, #20, all of M3 |
| D2 | Destination and scope are **orthogonal**; scope changes never change destination | **Adopt**, splitting `selectRepository` into a Code-local action and a scope-only one (§6) | @matbrgz | the implementation issue |
| D3 | Marketplace is a **mode** inside the third destination, not a sixth slot | **Adopt** — same noun (#10 §5.1) | @matbrgz | #48, #49 |
| D4 | Ceiling of **seven** destinations; Fleet and Tasks reserved | **Adopt** — an eighth requires a new RFC, not a PR | @matbrgz | M4, M7 |
| D5 | Review (M6) is a lens in Code plus rows in Home, not a destination | **Adopt** — the noun is a change, and Code owns changes | @matbrgz | M6 |
| D6 | Persist destination + scope + expansion; never filter text or scroll | **Adopt**; `localStorage`, not the tier-2 store (#14) | eng | #14 |
| D7 | Code declares a **required** scope; `Code × global` renders the project picker | **Adopt** — a property of the destination, not an exception to D2 | eng | #19 |
| D8 | Scope selector is a **path** (global → project → worktree), app-global, in the rail | **Adopt** — a flat list has nowhere to put worktrees (M4) | design | M4 |

D1 and D2 are the maintainer's calls. D3–D5 follow from D1; D6–D8 are engineering and design
calls recorded here so they are not rediscovered during implementation.

## 13. Acceptance criteria (self-check)

- [x] A criterion that decides destination-vs-lens, stated before the list — §4
- [x] The destination set that follows from it, with the veto shown doing work — §5
- [x] Per destination: what it owns, shows, does not show, and what empty means — §5.1–5.6
- [x] The project-scope selector: what it is, where it lives, app-global or not, and what "no
      project" means — §7.2, §7.3
- [x] The scope model across global / project / worktree without losing your place — §7.1, §6.1
- [x] What persists between sessions — §8
- [x] Where extensions, marketplace, fleet and review land — §5.3, §5.6, table in §5
- [x] Rail vs context: orthogonal or hierarchical — **orthogonal**, §6, with the required-scope
      qualifier in §7.2
- [x] No drawer assumed (`docs/BRIEFING.md:272`, `detail-pane.tsx:37-39`) — §3

## 14. Files cited (read, not modified)

- `app/src/models/app-section.ts` — `AppSection`, `isWorkspaceSection`
- `app/src/ui/rail/app-rail.tsx:25`, `:58-64`, `:243-286`, `:305` — destinations, scope selector, attention badge
- `app/src/ui/app.tsx:4202`, `:3497-3518`, `:3520-3540`, `:3542-3558`, `:4297-4304` — toolbar, section and scope handlers, attention count, routing, workspace center
- `app/src/ui/dispatcher/dispatcher.ts:366-382`, `:393-395` — `selectRepository` and its forcing of Code, `setAppSection`
- `app/src/lib/stores/app-store.ts:477`, `:486`, `:556-633`, `:840`, `:1354-1363` — persisted keys, the unpersisted section, `_setAppSection`
- `app/src/lib/workspace/scan-global.ts:78` — absence is an answer, not an error
- `app/src/lib/workspace/cleanup.ts:64-152` — the deletion guarantees Disk inherits
- `app/src/lib/git/worktree.ts` — the noun Fleet will own
- `app/src/ui/lib/detail-pane.tsx:37-39`, `docs/BRIEFING.md:272` — no drawer primitive
- `docs/superpowers/rfcs/2026-07-12-taxonomy.md` §5.1–5.2 — Extension, Capability
- `docs/superpowers/rfcs/2026-07-12-extension-model.md` §5.1–5.2 — kind, scope
- `docs/superpowers/rfcs/2026-07-12-marketplace-arch.md` §6 — the catalog the Browse mode renders
