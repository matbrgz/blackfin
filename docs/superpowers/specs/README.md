# Blackfin — spec index and roadmap

**Blackfin is the Agentic Control Center for Developers.**

A desktop git client, forked from GitHub Desktop, rebuilt around a premise: developers
now ship code they did not write. The agent wrote it. And every tool in the stack still
assumes a human typed every line.

Blackfin assumes otherwise. It treats the agent as a first-class actor in the
repository — the context you give it, the branches it works on, the lines it authored,
and the review you send back to it.

## What we are not building

Orca (`stablyai/orca`) is the reference point for this category, and it is excellent.
It is an **ADE** — an Agent Development Environment. It embeds terminals, a Monaco
editor, and a full Chromium browser, and runs fleets of agents inside itself.

Blackfin is not that, deliberately. Bolting a terminal multiplexer, an editor, and a
browser onto a git client is not an enhancement — it is a rewrite, and it would arrive
second. Our asset is the inverse: **we are already the best desktop git client there
is.** The diff viewer, the partial staging, the history, the branch and PR flows are
mature, fast, and trusted.

So Blackfin is the control center *where the git already is*. Every feature below
grafts onto a surface the app already owns.

## Roadmap

| Spec | What | Status |
| --- | --- | --- |
| [Agent Context](./2026-07-12-blackfin-agent-context-design.md) | Discover and index `CLAUDE.md`, `AGENTS.md`, Cursor/Copilot/Gemini/Windsurf rules across every project. A cross-project center plus a per-project screen. Broken `@import` detection. | Approved · [tasks](./2026-07-12-blackfin-agent-context-tasks.md) |
| Tasks | GitHub Projects board in-app, Issues/Linear/Jira drawers, branch-from-card with the link retained, board status synced back to the tracker, failing CI checks surfaced with their logs. | Drafting |
| Worktrees + Fleet Board | Worktrees as first-class citizens: create/archive from the UI, parent/child lineage, agent-written checkpoints, kanban board with lanes derivable from PR state. | Drafting |
| AI Attribution | Record the line ranges an agent authored; mark them in the diff gutter; flip to human when a human edits them. Local only, never committed. | Drafting |
| Diff Annotations | Markdown comments anchored to diff lines that follow the code, batched into a single prompt and sent to an agent. | Drafting |
| Project Overview | GitHub-style landing per project: README, last commit, contribution graph, contributors, agent-context card. | Sketched |
| Rebrand | Product name, bundle IDs, update URLs, icons, packaging. Severs auto-update from Desktop Plus. | Sketched |

## Candidate, not yet specced

**A self-describing `blackfin` CLI.** Orca's highest-leverage idea by a distance: the
app publishes a machine-readable schema of its own 200 operations — flags, examples,
and prose guardrails — so agents *discover* the API instead of guessing at it, and ship
it to agents as an installable Skill rather than an MCP server.

This matters to Blackfin more than it looks. Without a surface an agent can *call*,
several features above degrade to read-only dashboards: the agent never writes its own
worktree checkpoint, never declares the line ranges it authored, never asks the app to
show the human a diff. The data has to come from somewhere, and today the only thing
that can produce it is the agent itself.

Sequencing note: attribution (which needs the agent to *report* what it wrote) and
checkpoints (which need the agent to *write* one) both have a hard dependency here.
Until the CLI exists, both must fall back to inference — attribution from commit
authorship and timing heuristics, checkpoints from the human. That fallback is
acceptable for a first cut and is specced as such, but it is a fallback.

## Conventions

- One spec per document, dated, in this directory.
- Every spec has a companion `-tasks.md`: issue-sized units with dependency order,
  acceptance criteria, and the files each touches.
- Tasks become real GitHub issues on `matbrgz/blackfin`. The issue carries the
  essentials and links here; the full rationale stays in the spec and is not duplicated.
- Each spec is implemented on its own branch, in its own worktree.
