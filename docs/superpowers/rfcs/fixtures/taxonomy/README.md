# Fixtures corpus — taxonomy classification contract

Companion to [`../2026-07-12-taxonomy.md`](../2026-07-12-taxonomy.md). One anonymised
directory tree per agent in `AgentId` (`app/src/models/workspace-inventory.ts:14-29`),
plus cross-cutting cases. Every tree is small, synthetic, and contains **no secret
values** — MCP `env` keys appear only as `<PLACEHOLDER>`.

This corpus is what turns the RFC from opinion into a contract: any implementation of the
taxonomy (#11 types, #21 migration, #43 MCP content) must classify these trees exactly as
annotated. The `.tree.txt` files are documentation of expected classification, not code;
#21 is free to render them as real on-disk fixtures under `app/test/fixtures/agent-configs/`.

## Per-agent trees (the fourteen)

| File | AgentId | What it exercises |
|---|---|---|
| `claude-code.tree.txt` | ClaudeCode | Plugin = 1 Extension + N Capabilities; loose skill = orphan; `requiresMcp` |
| `shared-agents-md.tree.txt` | Shared | `AGENTS.md` belongs to no agent; `.agents/skills` cross-scope dedup |
| `codex.tree.txt` | Codex | Consumes `AGENTS.md` (agent=Shared); MCP-in-config unverified |
| `cursor.tree.txt` | Cursor | `.cursorrules` orphan; `.mdc` rules; `mcp.json` entries; empty Extension column |
| `copilot.tree.txt` | Copilot | `.github/` special case; instructions + prompts only |
| `gemini.tree.txt` | Gemini | `GEMINI.md`; MCP-in-settings unverified; no plugin/skill |
| `opencode.tree.txt` | OpenCode | Singular `command`/`agent` dirs; `AGENTS.md` |
| `antigravity.tree.txt` | Antigravity | In code ⇒ in contract (D8); surface unverified |
| `kimi.tree.txt` | Kimi | `KIMI.md`; surface unverified |
| `windsurf.tree.txt` | Windsurf | `.windsurfrules`; workflows/MCP unverified |
| `aider.tree.txt` | Aider | `CONVENTIONS.md`, no home dir |
| `cline.tree.txt` | Cline | `.clinerules`; directory-form and MCP unverified |
| `goose.tree.txt` | Goose | `.goosehints`; Goose "extension" == mcp-server, NOT Blackfin Extension |
| `continue.tree.txt` | Continue | "blocks" are config, NOT containers-with-manifest |

## Cross-cutting cases

| File | What it exercises |
|---|---|
| `mcp-multi-transport.tree.txt` | One `mcp.json`, three servers (stdio/stdio/http) ⇒ 3 mcp-server Capabilities, not 1 Settings blob; no env value ever surfaces |

## Cases that break a naive model (per issue #10)

- **Plugin container** — `claude-code.tree.txt`: 1 Extension + 6 Capabilities, not 7 loose items.
- **Same skill, two scopes (D4)** — `claude-code.tree.txt` `.claude/skills/pdf/` and
  `shared-agents-md.tree.txt` `.agents/skills/pdf/`: same Capability iff `contentHash + name` match.
- **MCP is an entry, not a file (§6.3, #43)** — `mcp-multi-transport.tree.txt`.
- **Same MCP across agents (sentence #2)** — `github` in `claude-code`/`mcp-multi-transport` vs `cursor`.
- **`AGENTS.md` owned by no agent** — `shared-agents-md.tree.txt`.
- **The orphan (most of the real world)** — `.cursorrules` in `cursor.tree.txt`, `extensionId=null`.
- **Malformed frontmatter** — the taxonomy must not demand more than `parse.ts:29-69`
  (`{ name: null, description: null }`, no throw); no fixture forces a stricter parse.

## Invariant every fixture asserts

- No environment-variable **value** appears in any classified output — only key presence.
- `extensionId` is `null` unless a manifest (Extension) declares ownership; never inferred.
- The disk predicate is the criterion of existence (Skill = `SKILL.md`, `catalog.ts:204`).
