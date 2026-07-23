import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  anchorFor,
  CapabilityKind,
  CapabilityScope,
  ExtensionSource,
} from '../../src/models/extension'
import { AgentId, ContextScope } from '../../src/models/workspace-inventory'
import {
  ExtensionOwnership,
  IInstallation,
} from '../../src/models/extension-registry'
import { ExtensionRegistryDatabase } from '../../src/lib/databases/extension-registry-database'

let counter = 0
function freshDb(): ExtensionRegistryDatabase {
  return new ExtensionRegistryDatabase(`ExtensionRegistry-Test-${++counter}`)
}

function makeInstallation(
  overrides: Partial<IInstallation> = {}
): IInstallation {
  return {
    installId: 'i1',
    kind: CapabilityKind.Skill,
    agent: AgentId.ClaudeCode,
    scope: ContextScope.Project,
    repositoryId: 1,
    rootPath: '/repo/.claude/skills/code-review',
    ownership: ExtensionOwnership.Managed,
    source: ExtensionSource.Git,
    sourceRef: 'github.com/acme/skills',
    anchor: anchorFor({
      scope: CapabilityScope.Project,
      agent: AgentId.ClaudeCode,
      kind: CapabilityKind.Skill,
      logicalName: 'code-review',
      contentHashAtInstall: 'h0',
      gitDir: '/repo/.git',
      lastKnownPath: '/repo/.claude/skills/code-review',
    }),
    name: 'code-review',
    description: null,
    version: '1.0.0',
    files: [{ relativePath: 'SKILL.md', sha256: 'a', byteLength: 10 }],
    declaredPermissions: [],
    pinned: false,
    installedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('ExtensionRegistryDatabase', () => {
  it('stores and reads back an installation by its installId', async () => {
    const db = freshDb()
    await db.installations.add(makeInstallation())
    const row = await db.installations.get('i1')
    assert.strictEqual(row?.rootPath, '/repo/.claude/skills/code-review')
    db.close()
  })

  it('rejects a second row with a duplicate installId', async () => {
    const db = freshDb()
    await db.installations.add(makeInstallation())
    await assert.rejects(() => db.installations.add(makeInstallation()))
    db.close()
  })

  it('rejects a second row with a duplicate rootPath (unique index)', async () => {
    const db = freshDb()
    await db.installations.add(makeInstallation())
    await assert.rejects(() =>
      db.installations.add(makeInstallation({ installId: 'i2' }))
    )
    db.close()
  })

  it('keeps the event trail append-only and ordered by time', async () => {
    const db = freshDb()
    await db.events.add({
      installId: 'i1',
      kind: 'installed',
      at: 30,
      detail: null,
    })
    await db.events.add({
      installId: 'i1',
      kind: 'updated',
      at: 10,
      detail: null,
    })
    await db.events.add({
      installId: 'i1',
      kind: 'forgotten',
      at: 20,
      detail: null,
    })
    const rows = await db.events.where('installId').equals('i1').sortBy('at')
    assert.deepStrictEqual(
      rows.map(r => r.kind),
      ['updated', 'forgotten', 'installed']
    )
    db.close()
  })
})
