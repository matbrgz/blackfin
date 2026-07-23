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
import { ExtensionRegistryStore } from '../../src/lib/stores/extension-registry-store'

let counter = 0
function freshStore(clock: () => number): {
  store: ExtensionRegistryStore
  db: ExtensionRegistryDatabase
} {
  const db = new ExtensionRegistryDatabase(
    `ExtensionRegistry-Store-${++counter}`
  )
  return { store: new ExtensionRegistryStore(db, clock), db }
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
    declaredPermissions: [{ id: 'read-files', reason: 'to lint your diff' }],
    pinned: false,
    installedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('ExtensionRegistryStore', () => {
  it('records a managed installation and its installed event', async () => {
    const { store } = freshStore(() => 42)
    await store.record(makeInstallation())
    const all = await store.getInstallations()
    assert.strictEqual(all.length, 1)
    const events = await store.getEvents('i1')
    assert.deepStrictEqual(
      events.map(e => e.kind),
      ['installed']
    )
    assert.strictEqual(events[0].at, 42)
  })

  it('rejects a managed installation that records no files', async () => {
    const { store } = freshStore(() => 1)
    await assert.rejects(() => store.record(makeInstallation({ files: [] })))
  })

  it('rejects a detected installation that claims files', async () => {
    const { store } = freshStore(() => 1)
    await assert.rejects(() =>
      store.record(
        makeInstallation({
          ownership: ExtensionOwnership.Detected,
          source: ExtensionSource.InstalledByBlackfin,
          // files is left non-empty by the fixture → must be rejected.
        })
      )
    )
  })

  it('records an adopted detected item with no files as a registered event', async () => {
    const { store } = freshStore(() => 7)
    await store.record(
      makeInstallation({
        ownership: ExtensionOwnership.Detected,
        source: ExtensionSource.InstalledByBlackfin,
        files: [],
      })
    )
    const events = await store.getEvents('i1')
    assert.deepStrictEqual(
      events.map(e => e.kind),
      ['registered']
    )
  })

  it('forget removes the row, appends forgotten, and never touches the filesystem', async () => {
    // The store's only collaborators are the db and the clock — it has no
    // filesystem dependency to call. We assert the observable effects.
    let t = 100
    const { store } = freshStore(() => t++)
    await store.record(makeInstallation())
    await store.forget('i1')
    assert.strictEqual((await store.getInstallations()).length, 0)
    const events = await store.getEvents('i1')
    assert.deepStrictEqual(
      events.map(e => e.kind),
      ['installed', 'forgotten']
    )
  })

  it('update bumps updatedAt and appends an updated event', async () => {
    // Start the clock above the fixture's installedAt/updatedAt (1000).
    let t = 2000
    const { store } = freshStore(() => t++)
    await store.record(makeInstallation())
    await store.update('i1', { version: '2.0.0', pinned: true })
    const row = await store.getInstallation('i1')
    assert.strictEqual(row?.version, '2.0.0')
    assert.strictEqual(row?.pinned, true)
    assert.ok((row?.updatedAt ?? 0) > 1000)
    const events = await store.getEvents('i1')
    assert.deepStrictEqual(
      events.map(e => e.kind),
      ['installed', 'updated']
    )
  })

  it('rejects a duplicate rootPath through the store', async () => {
    const { store } = freshStore(() => 1)
    await store.record(makeInstallation())
    await assert.rejects(() =>
      store.record(makeInstallation({ installId: 'i2' }))
    )
  })

  it('never persists a key that looks like a secret with a non-null value', async () => {
    const { store } = freshStore(() => 1)
    await store.record(makeInstallation())
    const all = await store.getInstallations()
    const suspicious = /token|secret|password|key$/i

    const offenders: Array<string> = []
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') {
        return
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (suspicious.test(k) && v !== null && v !== undefined) {
          offenders.push(`${path}.${k}`)
        }
        walk(v, `${path}.${k}`)
      }
    }
    walk(JSON.parse(JSON.stringify(all)), '$')
    assert.deepStrictEqual(offenders, [])
  })
})
