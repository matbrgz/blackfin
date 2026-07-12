import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { scanRepository } from '../../src/lib/workspace/scan'
import {
  AgentId,
  ContextRole,
  ArtifactKind,
  reclaimableBytes,
  brokenReferences,
  configuredAgents,
} from '../../src/models/workspace-inventory'

let root: string

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = Path.join(root, relativePath)
  await mkdir(Path.dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

const scan = () =>
  scanRepository(1, root, 1234, { measureArtifacts: true })

describe('scanRepository', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-scan-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reports a missing repository rather than throwing', async () => {
    const inventory = await scanRepository(1, Path.join(root, 'nope'), 1234, {
      measureArtifacts: true,
    })
    assert.deepEqual(inventory.status, { kind: 'missing' })
    assert.deepEqual(inventory.contextFiles, [])
  })

  it('finds context, docs and artifacts across a repository', async () => {
    await write('CLAUDE.md', '# Project\n\n- Run tests before pushing\n')
    await write('packages/api/CLAUDE.md', '# API\n\n- Use postgres\n')
    await write('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    await write('.github/copilot-instructions.md', '# Copilot\n')
    await write('README.md', '# The Readme\n')
    await write('docs/architecture.md', '# Architecture\n')
    await write('src/index.ts', 'export const x = 1\n')
    await write('package.json', '{}')
    await write('node_modules/left-pad/index.js', 'x'.repeat(100))
    await write('dist/bundle.js', 'y'.repeat(50))

    const inventory = await scan()

    assert.deepEqual(inventory.status, { kind: 'ok' })

    const paths = inventory.contextFiles.map(f => f.relativePath).sort()
    assert.deepEqual(paths, [
      '.claude/skills/deploy/SKILL.md',
      '.github/copilot-instructions.md',
      'CLAUDE.md',
      'packages/api/CLAUDE.md',
    ])

    const docPaths = inventory.docs.map(d => d.relativePath).sort()
    assert.deepEqual(docPaths, ['README.md', 'docs/architecture.md'])

    const artifactPaths = inventory.artifacts.map(a => a.relativePath).sort()
    assert.deepEqual(artifactPaths, ['dist', 'node_modules'])
  })

  it('measures artifact directories and totals them', async () => {
    await write('package.json', '{}')
    await write('node_modules/a/index.js', 'x'.repeat(100))
    await write('node_modules/b/index.js', 'x'.repeat(200))
    await write('dist/out.js', 'y'.repeat(50))

    const inventory = await scan()

    const nodeModules = inventory.artifacts.find(
      a => a.relativePath === 'node_modules'
    )
    assert.equal(nodeModules?.kind, ArtifactKind.Dependencies)
    assert.equal(nodeModules?.byteLength, 300)
    assert.equal(nodeModules?.fileCount, 2)

    assert.equal(reclaimableBytes(inventory), 350)
  })

  it('does not descend into artifact directories', async () => {
    // A CLAUDE.md inside node_modules belongs to a dependency, not to you.
    // Reporting it would be noise, and walking a hundred thousand files to find
    // it would make a scan cost minutes.
    await write('node_modules/some-package/CLAUDE.md', '# Not yours\n')

    const inventory = await scan()

    assert.deepEqual(inventory.contextFiles, [])
    assert.equal(inventory.artifacts.length, 1)
  })

  it('does not treat dist as build output without a manifest beside it', async () => {
    // No package.json here, so this dist/ is somebody's source directory.
    await write('dist/hand-written.js', 'x')

    const inventory = await scan()

    assert.deepEqual(inventory.artifacts, [])
  })

  it('does not follow symlinks', async () => {
    // pnpm's node_modules is a forest of them, and a cyclic link would
    // otherwise walk until the stack gives out.
    await write('real/CLAUDE.md', '# Real\n')
    await symlink(Path.join(root, 'real'), Path.join(root, 'link'), 'dir')
    await symlink(root, Path.join(root, 'loop'), 'dir')

    const inventory = await scan()

    assert.deepEqual(
      inventory.contextFiles.map(f => f.relativePath),
      ['real/CLAUDE.md']
    )
  })

  it('resolves references and flags the broken ones', async () => {
    await write('docs/exists.md', '# Here\n')
    await write(
      'CLAUDE.md',
      ['# Project', '', 'See @docs/exists.md.', 'And @docs/deleted.md.'].join('\n')
    )

    const inventory = await scan()

    const claude = inventory.contextFiles.find(f => f.relativePath === 'CLAUDE.md')!
    const byTarget = new Map(claude.references.map(r => [r.target, r.exists]))

    assert.equal(byTarget.get('docs/exists.md'), true)
    assert.equal(byTarget.get('docs/deleted.md'), false)

    const broken = brokenReferences(inventory)
    assert.equal(broken.length, 1)
    assert.equal(broken[0].reference.target, 'docs/deleted.md')
  })

  it('resolves references relative to the file that made them', async () => {
    await write('packages/api/notes.md', '# Notes\n')
    await write('packages/api/CLAUDE.md', 'See @notes.md.\n')

    const inventory = await scan()

    const claude = inventory.contextFiles.find(
      f => f.relativePath === 'packages/api/CLAUDE.md'
    )!
    assert.equal(claude.references[0].exists, true)
  })

  it('parses skill frontmatter, which is what makes an inventory readable', async () => {
    await write(
      '.claude/skills/deploy/SKILL.md',
      [
        '---',
        'name: deploy-to-prod',
        'description: Ships the current branch',
        '---',
        '# Deploy',
        '- Check CI first',
      ].join('\n')
    )

    const inventory = await scan()
    const skill = inventory.contextFiles[0]

    assert.equal(skill.role, ContextRole.Skill)
    assert.equal(skill.agent, AgentId.ClaudeCode)
    assert.equal(skill.name, 'deploy-to-prod')
    assert.equal(skill.description, 'Ships the current branch')
    assert.equal(skill.ruleCount, 1)
  })

  it('reports which agents a repository is configured for', async () => {
    await write('CLAUDE.md', '# a\n')
    await write('AGENTS.md', '# b\n')
    await write('.cursor/rules/style.mdc', '# c\n')

    const agents = configuredAgents(await scan()).sort()

    assert.deepEqual(agents, [AgentId.ClaudeCode, AgentId.Cursor, AgentId.Shared].sort())
  })

  it('skips the git directory', async () => {
    await write('.git/CLAUDE.md', '# not real\n')

    const inventory = await scan()

    assert.deepEqual(inventory.contextFiles, [])
  })

  it('skips measuring artifacts when asked not to, but still finds them', async () => {
    await write('node_modules/a/index.js', 'x'.repeat(100))

    const inventory = await scanRepository(1, root, 1234, {
      measureArtifacts: false,
    })

    assert.equal(inventory.artifacts.length, 1)
    assert.equal(inventory.artifacts[0].byteLength, 0)
  })
})
