import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentId, ContextRole } from '../../src/models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  anchorFor,
  anchorKey,
  capabilityIdentityKey,
  capabilityKindForRole,
  logicalNameFor,
} from '../../src/models/extension'

describe('capabilityKindForRole', () => {
  it('maps the five installable roles through 1:1', () => {
    assert.equal(capabilityKindForRole(ContextRole.Skill), CapabilityKind.Skill)
    assert.equal(
      capabilityKindForRole(ContextRole.Command),
      CapabilityKind.Command
    )
    assert.equal(
      capabilityKindForRole(ContextRole.Subagent),
      CapabilityKind.Subagent
    )
    assert.equal(
      capabilityKindForRole(ContextRole.Prompt),
      CapabilityKind.Prompt
    )
    assert.equal(capabilityKindForRole(ContextRole.Hook), CapabilityKind.Hook)
  })

  it('maps Instructions to the Instruction kind (a CLAUDE.md is a capability of effect)', () => {
    assert.equal(
      capabilityKindForRole(ContextRole.Instructions),
      CapabilityKind.Instruction
    )
  })

  it('returns null for Settings: a settings file is a container of mcp-servers, not a kind', () => {
    // This test exists to stop someone "fixing" the null into a `settings` kind.
    assert.equal(capabilityKindForRole(ContextRole.Settings), null)
  })

  it('is total over ContextRole: every member has a decided destination', () => {
    for (const role of Object.values(ContextRole)) {
      const kind = capabilityKindForRole(role)
      const decided =
        kind === null || Object.values(CapabilityKind).includes(kind)
      assert.ok(decided, `ContextRole.${role} has no decided kind`)
    }
  })
})

describe('logicalNameFor', () => {
  it('uses the frontmatter name when present', () => {
    assert.equal(
      logicalNameFor(
        CapabilityKind.Skill,
        '.claude/skills/pdf/SKILL.md',
        'code-review'
      ),
      'code-review'
    )
  })

  it('uses the manifest DIRECTORY basename for a nameless skill, not SKILL.md', () => {
    assert.equal(
      logicalNameFor(
        CapabilityKind.Skill,
        '.claude/skills/code-review/SKILL.md',
        null
      ),
      'code-review'
    )
  })

  it('uses the file basename without extension for a nameless command', () => {
    assert.equal(
      logicalNameFor(
        CapabilityKind.Command,
        '.claude/commands/deploy.md',
        null
      ),
      'deploy'
    )
  })

  it('gives the same logical name for the same skill in Global and in Project', () => {
    const global = logicalNameFor(
      CapabilityKind.Skill,
      'skills/code-review/SKILL.md',
      null
    )
    const project = logicalNameFor(
      CapabilityKind.Skill,
      '.claude/skills/code-review/SKILL.md',
      null
    )
    assert.equal(global, project)
  })

  it('never turns a hostile frontmatter name into a path', () => {
    const hostile = logicalNameFor(
      CapabilityKind.Skill,
      '.claude/skills/x/SKILL.md',
      '../../../etc/passwd'
    )
    assert.ok(!hostile.includes('/'))
    assert.ok(!hostile.includes('\\'))
    assert.ok(!hostile.includes('..'))
  })

  it('falls back to the basename for an empty frontmatter name', () => {
    assert.equal(
      logicalNameFor(CapabilityKind.Skill, '.claude/skills/pdf/SKILL.md', ''),
      'pdf'
    )
  })

  it('caps an absurdly long frontmatter name', () => {
    const huge = 'a'.repeat(10000)
    const name = logicalNameFor(
      CapabilityKind.Skill,
      '.claude/skills/x/SKILL.md',
      huge
    )
    assert.ok(name.length <= 200)
  })
})

describe('capabilityIdentityKey', () => {
  it('is equal for the same skill across scopes (path is location, not identity)', () => {
    const a = capabilityIdentityKey(
      CapabilityKind.Skill,
      AgentId.ClaudeCode,
      'code-review'
    )
    const b = capabilityIdentityKey(
      CapabilityKind.Skill,
      AgentId.ClaudeCode,
      'code-review'
    )
    assert.equal(a, b)
  })

  it('differs when the agent differs, even with the same name', () => {
    const claude = capabilityIdentityKey(
      CapabilityKind.Skill,
      AgentId.ClaudeCode,
      'code-review'
    )
    const shared = capabilityIdentityKey(
      CapabilityKind.Skill,
      AgentId.Shared,
      'code-review'
    )
    assert.notEqual(claude, shared)
  })
})

describe('anchorFor / anchorKey', () => {
  const base = {
    agent: AgentId.ClaudeCode,
    kind: CapabilityKind.Skill,
    logicalName: 'code-review',
    contentHashAtInstall: 'hash-1',
    gitDir: null,
    lastKnownPath: 'skills/code-review/SKILL.md',
  }

  it('builds an anchor from its parts', () => {
    const anchor = anchorFor({ ...base, scope: CapabilityScope.Global })
    assert.equal(anchor.scope, CapabilityScope.Global)
    assert.equal(anchor.contentHashAtInstall, 'hash-1')
    assert.equal(anchor.lastKnownPath, 'skills/code-review/SKILL.md')
  })

  it('produces different keys for the same item in different scopes', () => {
    const global = anchorKey(
      anchorFor({ ...base, scope: CapabilityScope.Global })
    )
    const project = anchorKey(
      anchorFor({ ...base, scope: CapabilityScope.Project })
    )
    assert.notEqual(global, project)
  })

  it('produces different keys when the content hash at install differs', () => {
    const a = anchorKey(anchorFor({ ...base, scope: CapabilityScope.Global }))
    const b = anchorKey(
      anchorFor({
        ...base,
        scope: CapabilityScope.Global,
        contentHashAtInstall: 'hash-2',
      })
    )
    assert.notEqual(a, b)
  })
})
