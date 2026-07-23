import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentId } from '../../src/models/workspace-inventory'
import type { IContextReference } from '../../src/models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  DETECTED,
  ExtensionSource,
  anchorFor,
  reconcile,
} from '../../src/models/extension'
import type {
  IDetectedCapability,
  IExtensionRecord,
} from '../../src/models/extension'

function detected(
  overrides: Partial<IDetectedCapability> = {}
): IDetectedCapability {
  return {
    kind: CapabilityKind.Skill,
    scope: CapabilityScope.Project,
    agents: [AgentId.ClaudeCode],
    relativePath: '.claude/skills/code-review/SKILL.md',
    logicalName: 'code-review',
    description: null,
    contentHash: 'hash-1',
    modifiedAt: 0,
    references: [],
    disabled: false,
    manifest: null,
    mcp: null,
    ...overrides,
  }
}

function record(overrides: Partial<IExtensionRecord> = {}): IExtensionRecord {
  const anchorOverrides = overrides.anchor
  const rec: IExtensionRecord = {
    id: 'rec-1',
    anchor: anchorFor({
      scope: CapabilityScope.Project,
      agent: AgentId.ClaudeCode,
      kind: CapabilityKind.Skill,
      logicalName: 'code-review',
      contentHashAtInstall: 'hash-1',
      gitDir: '/repo/.git',
      lastKnownPath: '.claude/skills/code-review/SKILL.md',
      ...(anchorOverrides ?? {}),
    }),
    source: ExtensionSource.Marketplace,
    sourceRef: 'market:code-review',
    installedVersion: '1.0.0',
    pinnedVersion: null,
    installedAt: 0,
    trust: null,
    ...overrides,
  }
  return rec
}

const brokenRef: IContextReference = {
  raw: './missing.md',
  target: '.claude/skills/code-review/missing.md',
  exists: false,
}

describe('reconcile — the divergence matrix', () => {
  it('file without record: detected, record null, source detected, enabled', () => {
    const [row] = reconcile([detected()], [])
    assert.equal(row.record, null)
    assert.equal(row.source, DETECTED)
    assert.deepEqual(row.state, { kind: 'enabled' })
    assert.equal(row.locallyModified, false)
    assert.ok(row.detected !== null)
  })

  it('file with record, hash equal: not locally modified, source from record', () => {
    const [row] = reconcile([detected()], [record()])
    assert.ok(row.record !== null)
    assert.equal(row.source, ExtensionSource.Marketplace)
    assert.equal(row.locallyModified, false)
  })

  it('hand-edited file under a record: locallyModified true, still anchored', () => {
    const [row] = reconcile(
      [detected({ contentHash: 'hash-EDITED' })],
      [record()]
    )
    assert.ok(row.record !== null)
    assert.equal(row.locallyModified, true)
  })

  it('moved file: resolved by content hash, re-anchored, not duplicated', () => {
    const moved = detected({
      relativePath: '.agents/skills/code-review/SKILL.md',
    })
    const results = reconcile([moved], [record()])
    assert.equal(results.length, 1, 'must not duplicate into a second row')
    assert.ok(results[0].record !== null)
    assert.equal(results[0].locallyModified, false)
    assert.equal(results[0].detected?.relativePath, moved.relativePath)
  })

  it('record without file: orphan, kept and reported, never dropped', () => {
    const results = reconcile([], [record()])
    assert.equal(results.length, 1)
    assert.equal(results[0].detected, null)
    assert.ok(results[0].record !== null)
    assert.equal(results[0].source, ExtensionSource.Marketplace)
  })

  it('unresolved references make an item broken, computed, regardless of record', () => {
    const [withRecord] = reconcile(
      [detected({ references: [brokenRef] })],
      [record()]
    )
    assert.equal(withRecord.state.kind, 'broken')
    const [withoutRecord] = reconcile(
      [detected({ references: [brokenRef] })],
      []
    )
    assert.equal(withoutRecord.state.kind, 'broken')
  })

  it('a disabled disk fact yields state disabled', () => {
    const [row] = reconcile([detected({ disabled: true })], [])
    assert.deepEqual(row.state, { kind: 'disabled' })
  })

  it('a detected item is NEVER outdated (no registry in the pure core)', () => {
    const rows = reconcile(
      [
        detected(),
        detected({ logicalName: 'other', relativePath: 'x/SKILL.md' }),
      ],
      []
    )
    for (const row of rows) {
      assert.notEqual(row.state.kind, 'outdated')
    }
  })

  it('an item with no manifest reconciles without inventing anything', () => {
    const [row] = reconcile([detected({ manifest: null })], [])
    assert.equal(row.detected?.manifest, null)
    assert.deepEqual(row.state, { kind: 'enabled' })
    assert.equal(row.relation.kind, 'none')
  })

  it('is deterministic: same inputs, same output', () => {
    const a = reconcile([detected()], [record()])
    const b = reconcile([detected()], [record()])
    assert.deepEqual(a, b)
  })
})

describe('reconcile — computed inherited/overridden relations', () => {
  const globalSkill = detected({
    scope: CapabilityScope.Global,
    relativePath: 'skills/code-review/SKILL.md',
    contentHash: 'global-hash',
  })
  const projectSkill = detected({
    scope: CapabilityScope.Project,
    relativePath: '.claude/skills/code-review/SKILL.md',
    contentHash: 'project-hash',
  })

  it('global item overridden by a same-identity project item; project item is none', () => {
    const rows = reconcile([globalSkill, projectSkill], [])
    const global = rows.find(r => r.detected?.scope === CapabilityScope.Global)
    const project = rows.find(
      r => r.detected?.scope === CapabilityScope.Project
    )
    assert.deepEqual(global?.relation, {
      kind: 'overridden',
      by: CapabilityScope.Project,
    })
    assert.deepEqual(project?.relation, { kind: 'none' })
  })

  it('a global item is inherited when a project is in view but does not override it', () => {
    const unrelatedProject = detected({
      scope: CapabilityScope.Project,
      logicalName: 'deploy',
      relativePath: '.claude/commands/deploy.md',
      kind: CapabilityKind.Command,
    })
    const rows = reconcile([globalSkill, unrelatedProject], [])
    const global = rows.find(r => r.detected?.scope === CapabilityScope.Global)
    assert.deepEqual(global?.relation, {
      kind: 'inherited',
      from: CapabilityScope.Global,
    })
  })

  it('different agents with the same name do not relate', () => {
    const globalClaude = globalSkill
    const projectShared = detected({
      scope: CapabilityScope.Project,
      agents: [AgentId.Shared],
      relativePath: '.agents/skills/code-review/SKILL.md',
      contentHash: 'shared-hash',
    })
    const rows = reconcile([globalClaude, projectShared], [])
    const global = rows.find(r =>
      r.detected?.agents.includes(AgentId.ClaudeCode)
    )
    // No override: the Shared item has a different identity, so the global
    // Claude item is merely inherited by the project in view.
    assert.equal(global?.relation.kind, 'inherited')
  })

  it('a worktree item overrides both the project and global items', () => {
    const worktreeSkill = detected({
      scope: CapabilityScope.Worktree,
      relativePath: '.claude/skills/code-review/SKILL.md',
      contentHash: 'worktree-hash',
    })
    const rows = reconcile([globalSkill, projectSkill, worktreeSkill], [])
    const global = rows.find(r => r.detected?.scope === CapabilityScope.Global)
    const project = rows.find(
      r => r.detected?.scope === CapabilityScope.Project
    )
    const worktree = rows.find(
      r => r.detected?.scope === CapabilityScope.Worktree
    )
    assert.deepEqual(global?.relation, {
      kind: 'overridden',
      by: CapabilityScope.Worktree,
    })
    assert.deepEqual(project?.relation, {
      kind: 'overridden',
      by: CapabilityScope.Worktree,
    })
    assert.deepEqual(worktree?.relation, { kind: 'none' })
  })
})
