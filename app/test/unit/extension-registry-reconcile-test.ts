import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  anchorFor,
  CapabilityKind,
  CapabilityScope,
  ExtensionSource,
  IExtensionAnchor,
} from '../../src/models/extension'
import { AgentId, ContextScope } from '../../src/models/workspace-inventory'
import {
  ExtensionOwnership,
  IInstallation,
} from '../../src/models/extension-registry'
import {
  correlationKeyForAnchor,
  IInstallationProbe,
  reconcileInstallations,
} from '../../src/lib/extensions/registry-reconcile'

function makeAnchor(
  overrides: Partial<IExtensionAnchor> = {}
): IExtensionAnchor {
  return anchorFor({
    scope: CapabilityScope.Project,
    agent: AgentId.ClaudeCode,
    kind: CapabilityKind.Skill,
    logicalName: 'code-review',
    contentHashAtInstall: 'h0',
    gitDir: '/repo/.git',
    lastKnownPath: '/repo/.claude/skills/code-review',
    ...overrides,
  })
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
    anchor: makeAnchor(),
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

function probe(
  pairs: ReadonlyArray<readonly [string, string]>,
  rootPresent = true,
  unreadableReason: string | null = null
): IInstallationProbe {
  return { rootPresent, unreadableReason, currentHashes: new Map(pairs) }
}

describe('reconcileInstallations', () => {
  it('reports a bare disk item with no record as unregistered-detected', () => {
    const detectedKeys = ['k1', 'k2', 'k3']
    const out = reconcileInstallations({
      installations: [],
      probes: new Map(),
      detectedKeys,
    })
    assert.strictEqual(out.length, 3)
    assert.ok(out.every(r => r.state.kind === 'unregistered-detected'))
    assert.ok(out.every(r => r.installId === null))
  })

  it('reports a managed item whose hashes all match as managed-clean', () => {
    const inst = makeInstallation()
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([[inst.installId, probe([['SKILL.md', 'a']])]]),
      detectedKeys: [],
    })
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].state.kind, 'managed-clean')
  })

  it('reports a hand-edited file as managed-modified naming exactly that file', () => {
    const inst = makeInstallation({
      files: [
        { relativePath: 'SKILL.md', sha256: 'a', byteLength: 10 },
        { relativePath: 'ref.md', sha256: 'b', byteLength: 20 },
      ],
    })
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([
        [
          inst.installId,
          probe([
            ['SKILL.md', 'a'],
            ['ref.md', 'CHANGED'],
          ]),
        ],
      ]),
      detectedKeys: [],
    })
    const state = out[0].state
    assert.strictEqual(state.kind, 'managed-modified')
    assert.deepStrictEqual(
      state.kind === 'managed-modified' ? state.changed : null,
      ['ref.md']
    )
  })

  it('treats a recorded file gone from disk as managed-modified, not missing', () => {
    const inst = makeInstallation({
      files: [
        { relativePath: 'SKILL.md', sha256: 'a', byteLength: 10 },
        { relativePath: 'ref.md', sha256: 'b', byteLength: 20 },
      ],
    })
    // Root is present, but only SKILL.md remains on disk.
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([[inst.installId, probe([['SKILL.md', 'a']])]]),
      detectedKeys: [],
    })
    const state = out[0].state
    assert.strictEqual(state.kind, 'managed-modified')
    assert.deepStrictEqual(
      state.kind === 'managed-modified' ? state.changed : null,
      ['ref.md']
    )
  })

  it('reports a managed item whose root is gone as managed-missing', () => {
    const inst = makeInstallation()
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([[inst.installId, probe([], false)]]),
      detectedKeys: [],
    })
    assert.strictEqual(out[0].state.kind, 'managed-missing')
  })

  it('reports a managed item with no probe at all as managed-missing', () => {
    const inst = makeInstallation()
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map(),
      detectedKeys: [],
    })
    assert.strictEqual(out[0].state.kind, 'managed-missing')
  })

  it('keeps reconciling the rest when one root is unreadable, carrying its reason', () => {
    const bad = makeInstallation({
      installId: 'bad',
      rootPath: '/repo/x',
      anchor: makeAnchor({ logicalName: 'x', lastKnownPath: '/repo/x' }),
    })
    const good = makeInstallation({
      installId: 'good',
      rootPath: '/repo/good',
      anchor: makeAnchor({ logicalName: 'good', lastKnownPath: '/repo/good' }),
    })
    const out = reconcileInstallations({
      installations: [bad, good],
      probes: new Map([
        ['bad', probe([], false, 'EACCES: permission denied')],
        ['good', probe([['SKILL.md', 'a']])],
      ]),
      detectedKeys: [],
    })
    const badState = out.find(r => r.installId === 'bad')!.state
    assert.strictEqual(badState.kind, 'managed-missing')
    assert.strictEqual(
      badState.kind === 'managed-missing' ? badState.reason : null,
      'EACCES: permission denied'
    )
    assert.strictEqual(
      out.find(r => r.installId === 'good')!.state.kind,
      'managed-clean'
    )
  })

  it('reports an adopted detected item as registered-detected, never managed-*', () => {
    const inst = makeInstallation({
      ownership: ExtensionOwnership.Detected,
      source: ExtensionSource.InstalledByBlackfin,
      files: [],
    })
    const out = reconcileInstallations({
      installations: [inst],
      // Even a broken probe must not turn a detected item into managed-missing.
      probes: new Map([[inst.installId, probe([], false)]]),
      detectedKeys: [],
    })
    assert.strictEqual(out[0].state.kind, 'registered-detected')
  })

  it('does not collide two items that share a name across scopes', () => {
    const project = makeInstallation({
      installId: 'p',
      scope: ContextScope.Project,
      anchor: makeAnchor({ scope: CapabilityScope.Project }),
    })
    const global = makeInstallation({
      installId: 'g',
      scope: ContextScope.Global,
      repositoryId: null,
      anchor: makeAnchor({ scope: CapabilityScope.Global, gitDir: null }),
    })
    assert.notStrictEqual(
      correlationKeyForAnchor(project.anchor),
      correlationKeyForAnchor(global.anchor)
    )
    const out = reconcileInstallations({
      installations: [project, global],
      probes: new Map([
        ['p', probe([['SKILL.md', 'a']])],
        ['g', probe([['SKILL.md', 'a']])],
      ]),
      detectedKeys: [],
    })
    assert.strictEqual(out.length, 2)
  })

  it('does not double-count a detected key that matches an installation', () => {
    const inst = makeInstallation()
    const key = correlationKeyForAnchor(inst.anchor)
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([[inst.installId, probe([['SKILL.md', 'a']])]]),
      detectedKeys: [key],
    })
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].state.kind, 'managed-clean')
  })

  it('correlates a hand-edited item to its row (key excludes the content hash)', () => {
    const inst = makeInstallation()
    // A fresh scan of the edited item builds its anchor from the NEW hash.
    const scannedKey = correlationKeyForAnchor(
      makeAnchor({ contentHashAtInstall: 'DIFFERENT-NOW' })
    )
    assert.strictEqual(scannedKey, correlationKeyForAnchor(inst.anchor))
    const out = reconcileInstallations({
      installations: [inst],
      probes: new Map([[inst.installId, probe([['SKILL.md', 'EDITED']])]]),
      detectedKeys: [scannedKey],
    })
    // One entry only: managed-modified, NOT also unregistered-detected.
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].state.kind, 'managed-modified')
  })
})
