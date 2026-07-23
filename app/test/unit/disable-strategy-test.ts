import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentId } from '../../src/models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  IDetectedCapability,
  IMcpServer,
} from '../../src/models/extension'
import {
  chooseDisableStrategy,
  chooseEnableStrategy,
  DisableStrategy,
} from '../../src/lib/extensions/disable-strategy'

// ─────────────────────────────────────────────────────────────
// Builders. A detected item is disk truth; every field is here so a test can
// vary exactly one dimension (kind / scope / agent) at a time.
// ─────────────────────────────────────────────────────────────

function detected(
  over: Partial<IDetectedCapability> & {
    readonly kind: CapabilityKind
    readonly scope: CapabilityScope
    readonly relativePath: string
  }
): IDetectedCapability {
  return {
    agents: [AgentId.ClaudeCode],
    logicalName: 'item',
    description: null,
    contentHash: 'hash',
    modifiedAt: 0,
    references: [],
    disabled: false,
    manifest: null,
    mcp: null,
    ...over,
  }
}

function mcpServer(over: Partial<IMcpServer>): IMcpServer {
  return {
    name: 'postgres',
    transport: 'stdio',
    command: null,
    args: [],
    envKeys: [],
    declaredIn: '.mcp.json',
    ...over,
  }
}

/** Narrowing helpers so assertions read on the discriminated union. */
function asMove(strategy: DisableStrategy) {
  assert.equal(strategy.kind, 'move')
  assert.ok(strategy.kind === 'move')
  return strategy
}
function asConfigEdit(strategy: DisableStrategy) {
  assert.equal(strategy.kind, 'config-edit')
  assert.ok(strategy.kind === 'config-edit')
  return strategy
}
function asUnsupported(strategy: DisableStrategy) {
  assert.equal(strategy.kind, 'unsupported')
  assert.ok(strategy.kind === 'unsupported')
  return strategy
}

// ─────────────────────────────────────────────────────────────
// config-edit: an agent + kind with a DOCUMENTED disable key.
// ─────────────────────────────────────────────────────────────

describe('chooseDisableStrategy — config-edit (documented native key)', () => {
  it('a Claude Code MCP server in a project .mcp.json → config-edit on disabledMcpjsonServers', () => {
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Project,
      relativePath: '.mcp.json',
      logicalName: 'postgres',
      mcp: mcpServer({ name: 'postgres', declaredIn: '.mcp.json' }),
    })

    const strategy = asConfigEdit(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(strategy.configPath, '.claude/settings.json')
    assert.equal(strategy.configKey, 'disabledMcpjsonServers')
    assert.equal(strategy.operation, 'add-to-disabled-list')
    // The entry is referenced BY NAME — the honest hook, and the secret-safe one.
    assert.equal(strategy.entryName, 'postgres')
    // A native row exists only with a documentation citation.
    assert.match(strategy.docCitation, /disabledMcpjsonServers/)
    assert.match(strategy.docCitation, /docs\.claude\.com/)
  })

  it('never invents a key: a Codex MCP server → unsupported, not a fabricated config-edit', () => {
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Project,
      relativePath: '.mcp.json',
      agents: [AgentId.Codex],
      logicalName: 'postgres',
      mcp: mcpServer({ name: 'postgres', declaredIn: '.mcp.json' }),
    })

    const strategy = asUnsupported(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(strategy.reason, 'agent-has-no-disable-mechanism')
    // The user is routed to the file they own, for #28.
    assert.equal(strategy.configPath, '.mcp.json')
  })
})

// ─────────────────────────────────────────────────────────────
// move: an agent/kind with no native mechanism, disabled by removal-from-scan.
// ─────────────────────────────────────────────────────────────

describe('chooseDisableStrategy — move (removal from the scanned path)', () => {
  it('a project-scoped skill → move, with the git-working-tree consequence flagged', () => {
    const item = detected({
      kind: CapabilityKind.Skill,
      scope: CapabilityScope.Project,
      relativePath: '.claude/skills/sql-lint/SKILL.md',
      logicalName: 'sql-lint',
    })

    const strategy = asMove(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    // A skill's root is its DIRECTORY, not the SKILL.md manifest.
    assert.equal(strategy.sourceRoot, '.claude/skills/sql-lint')
    assert.equal(strategy.proposedTarget, 'sql-lint')
    assert.notEqual(strategy.gitConsequence, null)
    assert.match(String(strategy.gitConsequence), /git/i)
    assert.match(String(strategy.gitConsequence), /removal/i)
  })

  it('a global skill disabled globally → move, with NO git consequence (~ is not a repo)', () => {
    const item = detected({
      kind: CapabilityKind.Skill,
      scope: CapabilityScope.Global,
      relativePath: '.claude/skills/pdf-review/SKILL.md',
      logicalName: 'pdf-review',
    })

    const strategy = asMove(
      chooseDisableStrategy(item, CapabilityScope.Global, null)
    )
    assert.equal(strategy.sourceRoot, '.claude/skills/pdf-review')
    assert.equal(strategy.gitConsequence, null)
  })

  it('a project command file → move on the file itself', () => {
    const item = detected({
      kind: CapabilityKind.Command,
      scope: CapabilityScope.Project,
      relativePath: '.claude/commands/deploy.md',
      logicalName: 'deploy',
    })

    const strategy = asMove(
      chooseDisableStrategy(item, CapabilityScope.Project, 3)
    )
    assert.equal(strategy.sourceRoot, '.claude/commands/deploy.md')
    assert.equal(strategy.proposedTarget, 'deploy.md')
  })
})

// ─────────────────────────────────────────────────────────────
// unsupported: the honest "can't". The most important behaviour in #40.
// ─────────────────────────────────────────────────────────────

describe('chooseDisableStrategy — unsupported (the honest refusal)', () => {
  it('a GLOBAL item disabled for ONE project (no override) → unsupported, reason names it, moves nothing', () => {
    const item = detected({
      kind: CapabilityKind.Skill,
      scope: CapabilityScope.Global,
      relativePath: '.claude/skills/pdf-review/SKILL.md',
      logicalName: 'pdf-review',
    })

    const strategy = asUnsupported(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(strategy.reason, 'global-item-project-scope-no-override')
    // No move path escapes into the refusal.
    assert.equal(strategy.configPath, null)
    assert.match(strategy.detail, /global/i)
  })

  it('an MCP entry whose agent documents no key → unsupported, configPath points at the user file', () => {
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Project,
      relativePath: 'settings.json',
      agents: [AgentId.ClaudeCode],
      logicalName: 'postgres',
      // declaredIn is a settings.json, not a .mcp.json ⇒ the documented key
      // does not apply here, so Blackfin refuses rather than guess.
      mcp: mcpServer({ name: 'postgres', declaredIn: '.claude/settings.json' }),
    })

    const strategy = asUnsupported(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(strategy.reason, 'agent-has-no-disable-mechanism')
    assert.equal(strategy.configPath, '.claude/settings.json')
  })

  it('a Claude Code GLOBAL MCP server disabled globally → unsupported (the key is for project .mcp.json only)', () => {
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Global,
      relativePath: '.claude.json',
      logicalName: 'postgres',
      mcp: mcpServer({ name: 'postgres', declaredIn: '.claude.json' }),
    })

    const strategy = asUnsupported(
      chooseDisableStrategy(item, CapabilityScope.Global, null)
    )
    assert.equal(strategy.reason, 'agent-has-no-disable-mechanism')
  })
})

// ─────────────────────────────────────────────────────────────
// enabling is the exact inverse of disabling.
// ─────────────────────────────────────────────────────────────

describe('chooseEnableStrategy — the inverse', () => {
  it('config-edit reverses: disable ADDS, enable REMOVES the same entry', () => {
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Project,
      relativePath: '.mcp.json',
      logicalName: 'postgres',
      mcp: mcpServer({ name: 'postgres', declaredIn: '.mcp.json' }),
    })

    const disable = asConfigEdit(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    const enable = asConfigEdit(
      chooseEnableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(disable.operation, 'add-to-disabled-list')
    assert.equal(enable.operation, 'remove-from-disabled-list')
    // Same target, same entry name — a true inverse.
    assert.equal(enable.configPath, disable.configPath)
    assert.equal(enable.configKey, disable.configKey)
    assert.equal(enable.entryName, disable.entryName)
  })

  it('move reverses: same paths, action flips to enable', () => {
    const item = detected({
      kind: CapabilityKind.Skill,
      scope: CapabilityScope.Project,
      relativePath: '.claude/skills/sql-lint/SKILL.md',
      logicalName: 'sql-lint',
    })

    const disable = asMove(
      chooseDisableStrategy(item, CapabilityScope.Project, 7)
    )
    const enable = asMove(
      chooseEnableStrategy(item, CapabilityScope.Project, 7)
    )
    assert.equal(disable.action, 'disable')
    assert.equal(enable.action, 'enable')
    assert.equal(enable.sourceRoot, disable.sourceRoot)
    assert.equal(enable.proposedTarget, disable.proposedTarget)
  })
})

// ─────────────────────────────────────────────────────────────
// Edge / empty inputs never throw — a pure function must always answer.
// ─────────────────────────────────────────────────────────────

describe('chooseDisableStrategy — edge inputs never throw', () => {
  it('an empty relative path → a well-formed malformed-item, not an exception', () => {
    const item = detected({
      kind: CapabilityKind.Skill,
      scope: CapabilityScope.Project,
      relativePath: '',
    })
    const strategy = asUnsupported(
      chooseDisableStrategy(item, CapabilityScope.Project, 1)
    )
    assert.equal(strategy.reason, 'malformed-item')
  })

  it('a junk item (cast through unknown) still returns a well-formed result', () => {
    const junk = {
      kind: CapabilityKind.Skill,
    } as unknown as IDetectedCapability
    const strategy = chooseDisableStrategy(junk, CapabilityScope.Global, null)
    assert.equal(strategy.kind, 'unsupported')
  })

  it('an item with no agents falls back to Shared without throwing', () => {
    const item = detected({
      kind: CapabilityKind.Command,
      scope: CapabilityScope.Project,
      relativePath: '.agents/commands/foo.md',
      agents: [],
    })
    const strategy = asMove(
      chooseDisableStrategy(item, CapabilityScope.Project, 1)
    )
    assert.equal(strategy.agent, AgentId.Shared)
  })
})

// ─────────────────────────────────────────────────────────────
// No secret ever appears in a returned strategy. RFC #11 §13 / #40 hard rule:
// tokens and secrets are never persisted, never carried. The strategy references
// an MCP entry BY NAME; a planted value in any other field must not leak.
// ─────────────────────────────────────────────────────────────

describe('no-secret-leak', () => {
  it('a planted secret value never appears in ANY returned strategy', () => {
    const SECRET = 'sk-super-secret-token-VALUE-1234567890'
    const item = detected({
      kind: CapabilityKind.McpServer,
      scope: CapabilityScope.Project,
      relativePath: '.mcp.json',
      logicalName: 'postgres',
      description: `connects using ${SECRET}`,
      mcp: mcpServer({
        name: 'postgres',
        declaredIn: '.mcp.json',
        // A secret could hide in the command, the args, or the env NAMES.
        command: SECRET,
        args: ['--password', SECRET],
        envKeys: [`TOKEN_${SECRET}`],
      }),
    })

    for (const strategy of [
      chooseDisableStrategy(item, CapabilityScope.Project, 7),
      chooseEnableStrategy(item, CapabilityScope.Project, 7),
    ]) {
      const serialized = JSON.stringify(strategy)
      assert.equal(
        serialized.includes(SECRET),
        false,
        `strategy leaked the secret: ${serialized}`
      )
    }
  })
})
