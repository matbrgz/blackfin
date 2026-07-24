# Research — Is "Agents" the right name for the section holding skills, MCP servers and plugins?

- **Date:** 2026-07-12
- **Issue:** [#16](https://github.com/matbrgz/blackfin/issues/16)
- **Status:** Research complete. Recommends **Context** for the rail label, with **Extensions** as the runner-up and the reasoning for both recorded. Awaiting maintainer ratification of **D1**.
- **Depends on:** [#15](https://github.com/matbrgz/blackfin/issues/15) — *the rail's destinations* — which supplied the input this question was blocked on: **what the destination owns**. Per #15 §5.3 it owns **Extension + Capability** (taxonomy #10 §5.1–5.2).
- **Delivers:** a decision and a follow-up rename issue. **Not** the rename itself (#16 out of scope).

---

## 1. The question, sharpened

The rail says **Agents** (`app-rail.tsx:61`). Behind it are skills, commands,
subagents, prompts, hooks, instruction files and — once #43 lands — MCP servers.

"Agents" names **the consumers of those things, not the things**. The issue states
the failure precisely, and it is testable: a person who has never seen Blackfin
reads the label and predicts they will find *running agent processes* — a task
board, sessions, logs. They are wrong, and they are wrong in a way that a
different label would fix.

That prediction is not hypothetical. It is the shape the backlog itself expects:
M4 (#57–#60) builds exactly that screen, and #15 §5.6 reserves a **separate**
destination for it. So the current label is not merely imprecise — it is
occupied by a destination that is genuinely coming.

## 2. What the code already decided

The strongest evidence is not the ecosystem survey. It is that **the shipped CLI
already split this vocabulary in two**, along exactly the boundary RFC #11 and
RFC #14 draw independently:

| Namespace | Commands | Which side of the boundary |
|---|---|---|
| `context` | `list`, `show`, `effective`, `move` | **Reading disk truth** — what reaches this directory, from any agent, installed or not |
| `extension` | `list`, `install`, `enable`, `disable` | **Managing** — the verbs that require a Blackfin record |

Both exist in `app/src/lib/cli/registry.ts`, both shipped, neither an accident.
`context list` even documents its `--kind` values as *"instructions, skill,
command, subagent, prompt, settings, hook"* — the full contents of the section
under discussion.

Two conclusions follow, and they carry the rest of this document:

1. **The section holds a superset of "extensions".** Most of what it shows is
   `detected` — a `CLAUDE.md` the user typed, a `.cursorrules` from a template.
   Under #11 §5.3, `detected` is precisely *the absence of an install record*.
   Nothing extended anything.
2. **The split is correct and should survive.** A label for the destination does
   not have to be the only noun in the product. The CLI proves two can coexist
   when each names a real distinction.

## 3. Ecosystem survey

Condensed from the ratified taxonomy (`2026-07-12-taxonomy.md` §3–4), which
surveyed all fourteen agents in `AgentId` against captured directory fixtures
(`docs/superpowers/rfcs/fixtures/taxonomy/`).

| Product | What it calls this category |
|---|---|
| Claude Code | **skills**, **commands**, **subagents**, **hooks**, and **plugins** as containers of those; a plugin marketplace |
| Cursor | **rules** (`.cursor/rules/*.mdc`); MCP separately |
| Copilot | **instructions** and **prompts** under `.github/` |
| Codex / OpenCode / Amp | the shared **`AGENTS.md`** convention — belongs to no product |
| Continue | **blocks** (models, rules, MCP servers) |
| Goose | **extensions** — for what everyone else calls MCP servers |
| Cline | **rules** |
| `npx skills add` | **skills**, into `.agents/skills/` |
| MCP spec | **servers**, providing **tools**, **resources**, **prompts** |

Adjacent product categories, for the verb rather than the noun:

| Product | Noun | Verb |
|---|---|---|
| VS Code | **extension** | install / enable / disable |
| Chrome | **extension** | install / remove |
| Homebrew | **formula**, **cask** | install |
| npm | **package** | install |
| oh-my-zsh, chezmoi | **plugin**, **dotfiles** | enable, apply |

**Finding.** There is no term whose meaning is stable across the agents — the
taxonomy already established that, and it is why Blackfin needed its own model.
But there *is* near-total convergence on the adjacent shelf: **"extension" is the
word this audience already has** for "the thing I install to change how another
tool behaves", and "install" is its verb.

Critically, that convergence is about **installing**. None of those products has
a screen for artifacts the user wrote by hand that were never installed — which
is the majority case here.

## 4. Candidates, tested against the five real uses

The five places the word has to fit (from the issue):

| # | Use | Constraint |
|---|---|---|
| 1 | Rail label | ~10 characters at 68px |
| 2 | Screen title | reads as a place |
| 3 | CLI noun | already taken — `context` **and** `extension` both ship |
| 4 | Dexie database name | `WorkspaceDatabase` (cache) and `ExtensionRegistryDatabase` (records) already exist |
| 5 | Marketplace copy | *"install this in your ___"* |

### A — Agents (status quo)

- **For:** users do think "my agents"; it is what is on screen today.
- **Against:** names the consumer, not the thing. Fails the issue's own test —
  predicts process control. And **M4 needs that meaning** (#15 §5.6). Keeping it
  here means either renaming it later anyway or shipping two destinations whose
  labels both promise agents.
- **Verdict: rejected.** The collision with M4 is decisive on its own.

### B — Context

- **For:** it is what the majority of the contents *are*, and it is the word the
  code already uses everywhere — `IContextFile`, `ContextRole`, `ContextScope`,
  `globalAgentContext`, `blackfin context list`, the `area:context` label. It
  covers detected and installed items equally, which is the section's actual
  shape. The screen title reads naturally: *"the context steering every agent,
  across every project"* — which is already the doc comment on `AppSection.Agents`
  (`app-section.ts:14`).
- **Against:** "context" also means the model's context window — a real collision
  in this exact domain. And an MCP server is a *tool*, not context, so the label
  slightly under-claims once #43 lands. Fails use 5 badly: *"install this in your
  Context"* does not read.
- **Verdict: strongest for uses 1–4, weakest for 5.**

### C — Extensions

- **For:** the ratified noun (#10 §5.1), the ecosystem's word, and a natural verb.
  Wins use 5 outright: *"install this in your extensions"*. Already the name of
  the tier-2 database.
- **Against:** **it mislabels the majority of the screen.** A hand-written
  `CLAUDE.md` is not an extension of anything, and #11 §5.3 says so structurally:
  `detected` is the absence of a record. Calling the destination Extensions makes
  the common case look like the exception. Second risk: for a desktop app,
  "Extensions" reads as *extensions of Blackfin*, which is a product Blackfin
  does not have and should not imply.
- **Verdict: runner-up.** Right for the marketplace, wrong for the rail.

### D — Capabilities

- **For:** the precise ratified noun for the unit of effect (#10 §5.2).
- **Against:** twelve characters, abstract, and *"install a capability"* is not a
  sentence anyone says. A precise internal term promoted to a label the user must
  decode.
- **Verdict: rejected for the label; kept as the internal noun it already is.**

### E — Stack

- **For:** evocative; already in the backlog's own vocabulary — #42 is literally
  *"Export a scope's agent stack"*.
- **Against:** no singular for a row (*"a stack item"*), collides with the
  technology-stack meaning, and predicts nothing specific. It is a good word for
  an **export**, which is where the backlog already uses it, and a poor one for a
  destination.
- **Verdict: rejected as a label; keep it for #42.**

### Summary

| Candidate | 1 Rail | 2 Title | 3 CLI | 4 DB | 5 Marketplace |
|---|---|---|---|---|---|
| Agents | ✗ collides with M4 | ✗ | ✗ | ✗ | ✗ |
| **Context** | **✓** | **✓** | **✓ ships** | ✓ | ✗ |
| Extensions | ~ over-claims | ~ | ✓ ships | ✓ | **✓** |
| Capabilities | ✗ long | ~ | ✗ | ~ | ✗ |
| Stack | ✗ | ~ | ✗ | ✗ | ✗ |

## 5. Recommendation

> **Rename the rail's third destination from "Agents" to "Context", and keep
> "extension" as the noun for the managed subset — in the CLI, in the registry,
> and in every marketplace sentence.**

The deciding argument is not elegance, it is proportion: **most of what the
section shows was never installed.** A label has to fit the common case, and the
common case is a file the user wrote. "Extensions" names the minority and makes
the majority look anomalous; "Context" names the whole and lets "extension"
retain its precise, smaller meaning — which is exactly the split the CLI already
shipped and the boundary RFC #14 formalises.

It also settles the M4 collision for free: **Agents** stops being spent on a
screen that has no agents in it, and is available for the destination that will.

### What this does not decide

The marketplace still says "extension" everywhere, and that is correct — #15 §5.3
makes Browse a **mode inside** this destination, not a sibling of it, so both
words appear on the same screen without competing. The mode control carries the
narrower noun; the rail carries the broader one.

## 6. Decision register

| # | Decision | Recommendation | Owner |
|---|---|---|---|
| D1 | The rail's third destination is labelled **Context** | **Adopt.** Fits the common case; frees "Agents" for M4 | @matbrgz |
| D2 | "Extension" stays the noun for the managed subset (CLI, registry, marketplace) | **Adopt** — the shipped CLI split is correct and should survive | @matbrgz |
| D3 | The rename executes **after** #15 ratifies the destination set | **Adopt** — no point naming a door that might stop existing | eng |
| D4 | `AppSection.Agents` (the enum member) renames with the label | **Adopt** — a member whose name contradicts its own doc comment is a trap for the next reader | eng |

## 7. Success criterion, restated as a test

From the issue: a person who has never seen Blackfin should read the label and
**correctly** predict what is behind it, and should **not** predict agent process
control.

- "Agents" → predicts sessions, runs, logs. **Wrong**, and it is the screen M4
  will actually build.
- "Context" → predicts the files and settings that steer their tools. **Right**,
  including for the `detected` majority.

## 8. Follow-up

The rename itself is a separate issue, opened as a consequence of this one, per
per #16.s stated scope. It covers the rail label, `AppSection.Agents`, the screen
title, any user-facing string, and the docs — and explicitly **not** the CLI's
`context`/`extension` split, which this research concludes is already right.

## 9. Files cited (read, not modified)

- `app/src/ui/rail/app-rail.tsx:61` — the label under discussion
- `app/src/models/app-section.ts:14` — the doc comment that already says "context"
- `app/src/lib/cli/registry.ts` — the shipped `context *` and `extension *` namespaces
- `app/src/lib/databases/extension-registry-database.ts` — "extension" as the tier-2 noun
- `docs/superpowers/rfcs/2026-07-12-taxonomy.md` §3–4, §5.1–5.2 — the agent survey and the ratified nouns
- `docs/superpowers/rfcs/2026-07-12-extension-model.md` §5.3 — `detected` is the absence of a record
- `docs/superpowers/rfcs/2026-07-12-information-architecture.md` §5.3, §5.6 — what the destination owns, and the reserved Fleet slot
