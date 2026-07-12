import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import {
  discoverRepositories,
  isRepository,
} from '../../src/lib/workspace/discover-repositories'

let root: string

async function dir(relativePath: string): Promise<void> {
  await mkdir(Path.join(root, relativePath), { recursive: true })
}

async function file(relativePath: string, content = ''): Promise<void> {
  const absolute = Path.join(root, relativePath)
  await mkdir(Path.dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function discover(): Promise<ReadonlyArray<string>> {
  const found = await discoverRepositories(root)
  return [...found].map(p => Path.relative(root, p)).sort()
}

describe('discoverRepositories', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-discover-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds repositories in a folder of projects', async () => {
    await dir('alpha/.git')
    await dir('beta/.git')
    await dir('not-a-project/src')

    assert.deepEqual(await discover(), ['alpha', 'beta'])
  })

  it('finds repositories nested a few levels down', async () => {
    await dir('work/client/api/.git')
    await dir('personal/blog/.git')

    assert.deepEqual(await discover(), ['personal/blog', 'work/client/api'])
  })

  it('recognises a linked worktree, whose .git is a file', async () => {
    // This is the case a naive isDirectory() check gets wrong, and a worktree
    // is every bit as much a checkout as the repository it came from.
    await file('feature-branch/.git', 'gitdir: /somewhere/.git/worktrees/x\n')

    assert.deepEqual(await discover(), ['feature-branch'])
  })

  it('does not descend into a repository it has already found', async () => {
    // Nested repositories are almost always submodules or vendored copies, and
    // adding them as top-level projects makes a mess the user has to undo.
    await dir('project/.git')
    await dir('project/vendor/dependency/.git')

    assert.deepEqual(await discover(), ['project'])
  })

  it('does not walk into node_modules', async () => {
    await dir('project/.git')
    await dir('other/node_modules/some-package/.git')
    await file('other/package.json', '{}')

    assert.deepEqual(await discover(), ['project'])
  })

  it('returns nothing for a folder with no repositories', async () => {
    await dir('just/some/directories')

    assert.deepEqual(await discover(), [])
  })

  it('returns the folder itself when it is a repository', async () => {
    await dir('.git')

    assert.deepEqual(await discover(), [''])
  })

  it('does not throw on an unreadable folder', async () => {
    const missing = Path.join(root, 'nope')

    assert.deepEqual(await discoverRepositories(missing), [])
  })
})

describe('isRepository', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-discover-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('is true for a checkout and false for an ordinary folder', async () => {
    await dir('repo/.git')
    await dir('plain')

    assert.equal(await isRepository(Path.join(root, 'repo')), true)
    assert.equal(await isRepository(Path.join(root, 'plain')), false)
  })
})
