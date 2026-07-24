import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AgentId,
  ContextRole,
  ContextScope,
  IContextFile,
  IGlobalContext,
  IRepositoryInventory,
} from '../../src/models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  ExtensionSource,
  IExtensionRecord,
  anchorFor,
  reconcile,
} from '../../src/models/extension'
import {
  KindsReachableFromInventory,
  UnknownContentHash,
  detectedCapabilitiesAcross,
  detectedCapabilitiesForGlobalContext,
  detectedCapabilitiesForInventory,
} from '../../src/lib/workspace/extension-adapter'

function contextFile(overrides: Partial<IContextFile> = {}): IContextFile {
  return {
    agent: AgentId.ClaudeCode,
    role: ContextRole.Skill,
    scope: ContextScope.Project,
    relativePath: '.claude/skills/code-review/SKILL.md',
    byteLength: 120,
    lineCount: 8,
    modifiedAt: 1700000000000,
    name: 'code-review',
    description: 'Reviews code',
    headings: [],
    ruleCount: 0,
    references: [],
    skippedReason: null,
    ...overrides,
  }
}

function inventory(
  files: ReadonlyArray<IContextFile>,
  repositoryId = 1
): IRepositoryInventory {
  return {
    repositoryId,
    repositoryPath: '/repos/project-a',
    scannedAt: 1700000000000,
    status: { kind: 'ok' },
    contextFiles: files,
    docs: [],
    artifacts: [],
  }
}

function globalContext(files: ReadonlyArray<IContextFile>): IGlobalContext {
  return {
    homePath: '/home/user',
    scannedAt: 1700000000000,
    status: { kind: 'ok' },
    contextFiles: files,
  }
}

describe('detectedCapabilitiesForInventory', () => {
  it('projects a scanned skill into the extension model', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()])
    )

    assert.equal(capability.kind, CapabilityKind.Skill)
    assert.equal(capability.scope, CapabilityScope.Project)
    assert.deepStrictEqual(capability.agents, [AgentId.ClaudeCode])
    assert.equal(capability.logicalName, 'code-review')
    assert.equal(capability.relativePath, '.claude/skills/code-review/SKILL.md')
    assert.equal(capability.description, 'Reviews code')
  })

  it('drops settings files rather than representing them as capabilities', () => {
    // A settings file declares mcp-servers; it is not one. Turning it into a
    // row would put `mcp.json` in the catalog instead of the servers inside it.
    const capabilities = detectedCapabilitiesForInventory(
      inventory([
        contextFile({ role: ContextRole.Settings, relativePath: '.mcp.json' }),
        contextFile(),
      ])
    )

    assert.equal(capabilities.length, 1)
    assert.equal(capabilities[0].kind, CapabilityKind.Skill)
  })

  it('never produces an mcp-server, because no ContextRole maps to one', () => {
    const everyRole = [
      ContextRole.Instructions,
      ContextRole.Skill,
      ContextRole.Command,
      ContextRole.Subagent,
      ContextRole.Prompt,
      ContextRole.Settings,
      ContextRole.Hook,
    ]

    const kinds = detectedCapabilitiesForInventory(
      inventory(everyRole.map(role => contextFile({ role })))
    ).map(c => c.kind)

    assert.ok(!kinds.includes(CapabilityKind.McpServer))
    assert.deepStrictEqual(
      [...new Set(kinds)],
      [...KindsReachableFromInventory]
    )
  })

  it('falls back to the basename when there is no frontmatter name', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile({ name: null })])
    )

    assert.equal(capability.logicalName, 'code-review')
  })

  it('carries references through, because they are what makes an item broken', () => {
    const references = [
      { raw: './docs/gone.md', target: 'docs/gone.md', exists: false },
    ]
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile({ references })])
    )

    assert.deepStrictEqual(capability.references, references)
  })

  it('preserves scan order', () => {
    const capabilities = detectedCapabilitiesForInventory(
      inventory([
        contextFile({ name: 'first' }),
        contextFile({ name: 'second' }),
        contextFile({ name: 'third' }),
      ])
    )

    assert.deepStrictEqual(
      capabilities.map(c => c.logicalName),
      ['first', 'second', 'third']
    )
  })
})

describe('detectedCapabilitiesForInventory — facts it refuses to invent', () => {
  it('reports the unknown-hash sentinel when nobody has read the bytes', () => {
    // The inventory carries byteLength and modifiedAt, never content. A
    // fabricated hash here would mean "hand-edited" for every installed item.
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()])
    )

    assert.equal(capability.contentHash, UnknownContentHash)
  })

  it('uses a supplied hash when the caller has one', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()]),
      { contentHashOf: () => 'abc123' }
    )

    assert.equal(capability.contentHash, 'abc123')
  })

  it('treats a null from the hash resolver as unknown, not as a hash', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()]),
      { contentHashOf: () => null }
    )

    assert.equal(capability.contentHash, UnknownContentHash)
  })

  it('reports nothing as disabled unless the caller says so', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()])
    )

    assert.equal(capability.disabled, false)
  })

  it('marks exactly the paths the caller established as disabled', () => {
    const capabilities = detectedCapabilitiesForInventory(
      inventory([
        contextFile({ relativePath: 'a/SKILL.md', name: 'a' }),
        contextFile({ relativePath: 'b/SKILL.md', name: 'b' }),
      ]),
      { disabledPaths: new Set(['b/SKILL.md']) }
    )

    assert.deepStrictEqual(
      capabilities.map(c => [c.logicalName, c.disabled]),
      [
        ['a', false],
        ['b', true],
      ]
    )
  })

  it('never claims a manifest, because the shipped parser cannot read one', () => {
    const [capability] = detectedCapabilitiesForInventory(
      inventory([contextFile()])
    )

    assert.equal(capability.manifest, null)
    assert.equal(capability.mcp, null)
  })

  it('does not expand AgentId.Shared into the agents that read AGENTS.md', () => {
    // Which of them are installed on this machine is not something the
    // inventory knows, and listing them would be a claim nobody verified.
    const [capability] = detectedCapabilitiesForInventory(
      inventory([
        contextFile({
          agent: AgentId.Shared,
          role: ContextRole.Instructions,
          relativePath: 'AGENTS.md',
        }),
      ])
    )

    assert.deepStrictEqual(capability.agents, [AgentId.Shared])
  })
})

describe('detectedCapabilitiesForGlobalContext', () => {
  it('projects home-directory context at global scope', () => {
    const [capability] = detectedCapabilitiesForGlobalContext(
      globalContext([
        contextFile({
          scope: ContextScope.Global,
          relativePath: '.claude/CLAUDE.md',
          role: ContextRole.Instructions,
          name: null,
        }),
      ])
    )

    assert.equal(capability.scope, CapabilityScope.Global)
    assert.equal(capability.kind, CapabilityKind.Instruction)
  })

  it('is empty for a machine with no agent configuration', () => {
    // Not an error. The agent simply is not installed.
    assert.deepStrictEqual(
      detectedCapabilitiesForGlobalContext(globalContext([])),
      []
    )
  })
})

describe('detectedCapabilitiesAcross', () => {
  it('puts global context first, then every repository in order', () => {
    const capabilities = detectedCapabilitiesAcross(
      globalContext([contextFile({ scope: ContextScope.Global, name: 'g' })]),
      [
        inventory([contextFile({ name: 'a' })], 1),
        inventory([contextFile({ name: 'b' })], 2),
      ]
    )

    assert.deepStrictEqual(
      capabilities.map(c => c.logicalName),
      ['g', 'a', 'b']
    )
  })

  it('tolerates a machine whose home directory was never scanned', () => {
    const capabilities = detectedCapabilitiesAcross(null, [
      inventory([contextFile({ name: 'a' })]),
    ])

    assert.deepStrictEqual(
      capabilities.map(c => c.logicalName),
      ['a']
    )
  })
})

describe('the adapter feeding reconcile()', () => {
  const record: IExtensionRecord = {
    id: 'r1',
    anchor: anchorFor({
      scope: CapabilityScope.Project,
      agent: AgentId.ClaudeCode,
      kind: CapabilityKind.Skill,
      logicalName: 'code-review',
      contentHashAtInstall: 'installed-hash',
      gitDir: '/repos/project-a/.git',
      lastKnownPath: '.claude/skills/code-review/SKILL.md',
    }),
    source: ExtensionSource.Marketplace,
    sourceRef: 'blackfin/code-review',
    installedVersion: '1.0.0',
    pinnedVersion: null,
    installedAt: 1600000000000,
    trust: null,
  }

  it('does not report an unread capability as hand-edited', () => {
    // The regression this guards: an inventory carries no hash, so without the
    // sentinel check every installed item would read as locally modified.
    const detected = detectedCapabilitiesForInventory(
      inventory([contextFile()])
    )

    const [reconciled] = reconcile(detected, [record])

    assert.equal(reconciled.detected?.contentHash, UnknownContentHash)
    assert.equal(reconciled.locallyModified, false)
    assert.equal(reconciled.source, ExtensionSource.Marketplace)
  })

  it('reports a hand-edit once the caller supplies a real hash', () => {
    const detected = detectedCapabilitiesForInventory(
      inventory([contextFile()]),
      { contentHashOf: () => 'edited-hash' }
    )

    const [reconciled] = reconcile(detected, [record])

    assert.equal(reconciled.locallyModified, true)
  })

  it('reports no hand-edit when the supplied hash matches the install', () => {
    const detected = detectedCapabilitiesForInventory(
      inventory([contextFile()]),
      { contentHashOf: () => 'installed-hash' }
    )

    const [reconciled] = reconcile(detected, [record])

    assert.equal(reconciled.locallyModified, false)
  })

  it('leaves a capability with no record as merely detected', () => {
    const detected = detectedCapabilitiesForInventory(
      inventory([contextFile({ name: 'unregistered' })])
    )

    const [reconciled] = reconcile(detected, [])

    assert.equal(reconciled.source, 'detected')
    assert.equal(reconciled.record, null)
  })
})
