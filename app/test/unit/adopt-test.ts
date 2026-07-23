import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CapabilityKind,
  CapabilityScope,
  IDetectedCapability,
  IExtensionManifest,
} from '../../src/models/extension'
import { AgentId, ContextScope } from '../../src/models/workspace-inventory'
import { ExtensionOwnership } from '../../src/models/extension-registry'
import {
  adoptionFromDetected,
  IAdoptionContext,
} from '../../src/lib/extensions/adopt'
import { ExtensionRegistryDatabase } from '../../src/lib/databases/extension-registry-database'
import { ExtensionRegistryStore } from '../../src/lib/stores/extension-registry-store'
import { reconcileInstallations } from '../../src/lib/extensions/registry-reconcile'

let counter = 0
function freshStore(clock: () => number = () => 1): ExtensionRegistryStore {
  const db = new ExtensionRegistryDatabase(
    `ExtensionRegistry-Adopt-${++counter}`
  )
  return new ExtensionRegistryStore(db, clock)
}

function makeDetected(
  overrides: Partial<IDetectedCapability> = {}
): IDetectedCapability {
  return {
    kind: CapabilityKind.Skill,
    scope: CapabilityScope.Global,
    agents: [AgentId.ClaudeCode],
    relativePath: '.claude/skills/pdf-review/SKILL.md',
    logicalName: 'pdf-review',
    description: 'Reviews PDFs',
    contentHash: 'h-abc',
    modifiedAt: 500,
    references: [],
    disabled: false,
    manifest: null,
    mcp: null,
    ...overrides,
  }
}

function makeManifest(
  overrides: Partial<IExtensionManifest> = {}
): IExtensionManifest {
  return {
    name: null,
    version: null,
    description: null,
    author: null,
    license: null,
    homepage: null,
    provides: [],
    requiresMcp: [],
    ...overrides,
  }
}

const globalContext: IAdoptionContext = {
  agent: AgentId.ClaudeCode,
  scopeRoot: '/home/user',
  gitDir: null,
  repositoryId: null,
}

describe('adoptionFromDetected', () => {
  it('projects a detected item as Detected, files [], source null', () => {
    const row = adoptionFromDetected(makeDetected(), globalContext, 1234)
    assert.strictEqual(row.ownership, ExtensionOwnership.Detected)
    assert.deepStrictEqual(row.files, [])
    assert.strictEqual(row.source, null)
    assert.strictEqual(row.sourceRef, null)
    assert.strictEqual(row.installedAt, 1234)
    assert.strictEqual(row.updatedAt, 1234)
  })

  it('never produces a Managed row and never claims files', () => {
    // Exhaustively vary the inputs adoption sees; the honesty stance must hold.
    const kinds = [
      CapabilityKind.Skill,
      CapabilityKind.Command,
      CapabilityKind.Subagent,
      CapabilityKind.McpServer,
    ]
    for (const kind of kinds) {
      for (const scope of [
        CapabilityScope.Global,
        CapabilityScope.Project,
        CapabilityScope.Worktree,
      ]) {
        const row = adoptionFromDetected(
          makeDetected({ kind, scope }),
          globalContext,
          1
        )
        assert.strictEqual(row.ownership, ExtensionOwnership.Detected)
        assert.strictEqual(row.files.length, 0)
        assert.strictEqual(row.source, null)
      }
    }
  })

  it('roots a Skill at its DIRECTORY, not the SKILL.md manifest', () => {
    const row = adoptionFromDetected(
      makeDetected({
        kind: CapabilityKind.Skill,
        relativePath: '.claude/skills/pdf-review/SKILL.md',
      }),
      globalContext,
      1
    )
    assert.strictEqual(row.rootPath, '/home/user/.claude/skills/pdf-review')
  })

  it('roots a Command at its own file', () => {
    const row = adoptionFromDetected(
      makeDetected({
        kind: CapabilityKind.Command,
        relativePath: '.claude/commands/deploy.md',
        logicalName: 'deploy',
      }),
      globalContext,
      1
    )
    assert.strictEqual(row.rootPath, '/home/user/.claude/commands/deploy.md')
  })

  it('takes name and description from the scanned frontmatter facts', () => {
    const row = adoptionFromDetected(
      makeDetected({ logicalName: 'pdf-review', description: 'Reviews PDFs' }),
      globalContext,
      1
    )
    assert.strictEqual(row.name, 'pdf-review')
    assert.strictEqual(row.description, 'Reviews PDFs')
  })

  it('leaves description null when the scan has none', () => {
    const row = adoptionFromDetected(
      makeDetected({ description: null }),
      globalContext,
      1
    )
    assert.strictEqual(row.description, null)
  })

  it('never fabricates a version — null unless the manifest declares one', () => {
    const noManifest = adoptionFromDetected(
      makeDetected({ manifest: null }),
      globalContext,
      1
    )
    assert.strictEqual(noManifest.version, null)

    const noVersion = adoptionFromDetected(
      makeDetected({ manifest: makeManifest({ version: null }) }),
      globalContext,
      1
    )
    assert.strictEqual(noVersion.version, null)

    const declared = adoptionFromDetected(
      makeDetected({ manifest: makeManifest({ version: '2.3.0' }) }),
      globalContext,
      1
    )
    assert.strictEqual(declared.version, '2.3.0')
  })

  it('carries the finer scope on the anchor but coarsens IInstallation.scope', () => {
    const worktree = adoptionFromDetected(
      makeDetected({ scope: CapabilityScope.Worktree }),
      { ...globalContext, gitDir: '/repo/.git', repositoryId: 3 },
      1
    )
    assert.strictEqual(worktree.scope, ContextScope.Project)
    assert.strictEqual(worktree.anchor.scope, CapabilityScope.Worktree)
  })

  it('gives two items differing only in scope distinct installIds', () => {
    const asGlobal = adoptionFromDetected(
      makeDetected({ scope: CapabilityScope.Global }),
      globalContext,
      1
    )
    const asProject = adoptionFromDetected(
      makeDetected({
        scope: CapabilityScope.Project,
        relativePath: '.claude/skills/pdf-review/SKILL.md',
      }),
      {
        agent: AgentId.ClaudeCode,
        scopeRoot: '/repo',
        gitDir: '/repo/.git',
        repositoryId: 1,
      },
      1
    )
    assert.notStrictEqual(asGlobal.installId, asProject.installId)
  })
})

describe('ExtensionRegistryStore.adopt', () => {
  it('records the adopted row and emits a registered event', async () => {
    const store = freshStore(() => 77)
    const row = await store.adopt(makeDetected(), globalContext)

    const all = await store.getInstallations()
    assert.strictEqual(all.length, 1)
    assert.strictEqual(all[0].installId, row.installId)
    assert.strictEqual(all[0].ownership, ExtensionOwnership.Detected)
    assert.strictEqual(all[0].source, null)
    assert.strictEqual(all[0].installedAt, 77)

    const events = await store.getEvents(row.installId)
    assert.deepStrictEqual(
      events.map(e => e.kind),
      ['registered']
    )
  })

  it('adopts a detected item that then reconciles to registered-detected', async () => {
    const store = freshStore()
    const row = await store.adopt(makeDetected(), globalContext)

    const installations = await store.getInstallations()
    const out = reconcileInstallations({
      installations,
      // Even with no probe, a Detected row must reconcile to registered-detected.
      probes: new Map(),
      detectedKeys: [],
    })
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].installId, row.installId)
    assert.strictEqual(out[0].state.kind, 'registered-detected')
  })

  it('records two items differing only in scope as two distinct rows', async () => {
    const store = freshStore()
    await store.adopt(
      makeDetected({ scope: CapabilityScope.Global }),
      globalContext
    )
    await store.adopt(
      makeDetected({
        scope: CapabilityScope.Project,
        relativePath: '.claude/skills/pdf-review/SKILL.md',
      }),
      {
        agent: AgentId.ClaudeCode,
        scopeRoot: '/repo',
        gitDir: '/repo/.git',
        repositoryId: 1,
      }
    )
    assert.strictEqual((await store.getInstallations()).length, 2)
  })
})
