import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm, symlink, access } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { checkDeletable, deleteArtifact } from '../../src/lib/workspace/cleanup'

let root: string

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = Path.join(root, relativePath)
  await mkdir(Path.dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function exists(relativePath: string): Promise<boolean> {
  return access(Path.join(root, relativePath)).then(
    () => true,
    () => false
  )
}

/** Deleting for real, rather than trashing, so the test needs no Electron. */
const unlink = {
  moveToTrash: false,
  moveItemToTrash: async () => {
    throw new Error('should not be called')
  },
}

describe('checkDeletable', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-cleanup-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('permits a genuine artifact directory', async () => {
    await write('node_modules/a/index.js', 'x')

    const check = await checkDeletable(root, 'node_modules')

    assert.equal(check.ok, true)
  })

  it('refuses a path that escapes the repository', async () => {
    const check = await checkDeletable(root, '../../../etc')

    assert.equal(check.ok, false)
    assert.match(check.ok ? '' : check.reason, /outside the repository/)
  })

  it('refuses the repository root itself', async () => {
    const check = await checkDeletable(root, '.')

    assert.equal(check.ok, false)
    assert.match(check.ok ? '' : check.reason, /repository root/)
  })

  it('refuses a symlink, even one named node_modules', async () => {
    // Following it would delete the target, which is how a tool like this eats
    // somebody's home directory.
    await mkdir(Path.join(root, 'real'))
    await symlink(
      Path.join(root, 'real'),
      Path.join(root, 'node_modules'),
      'dir'
    )

    const check = await checkDeletable(root, 'node_modules')

    assert.equal(check.ok, false)
    assert.match(check.ok ? '' : check.reason, /Not a directory/)
    assert.equal(await exists('real'), true)
  })

  it('refuses source directories, however tempting the name', async () => {
    // No package.json beside it, so this dist/ is somebody's source.
    await write('dist/hand-written.js', 'x')

    const check = await checkDeletable(root, 'dist')

    assert.equal(check.ok, false)
    assert.match(check.ok ? '' : check.reason, /No longer classifies/)
  })

  it('refuses an ordinary directory', async () => {
    await write('src/index.ts', 'x')

    const check = await checkDeletable(root, 'src')

    assert.equal(check.ok, false)
  })

  it('refuses a directory that has already gone', async () => {
    const check = await checkDeletable(root, 'node_modules')

    assert.equal(check.ok, false)
    assert.match(check.ok ? '' : check.reason, /no longer exists/)
  })
})

describe('deleteArtifact', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-cleanup-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('deletes an artifact directory', async () => {
    await write('node_modules/a/index.js', 'x')

    const outcome = await deleteArtifact(root, 'node_modules', unlink)

    assert.equal(outcome.kind, 'deleted')
    assert.equal(await exists('node_modules'), false)
  })

  it('reports a refusal rather than throwing', async () => {
    // So a cleanup across twenty repositories does not abandon the other
    // nineteen because one refused.
    await write('src/index.ts', 'x')

    const outcome = await deleteArtifact(root, 'src', unlink)

    assert.equal(outcome.kind, 'refused')
    assert.equal(await exists('src'), true)
  })

  it('moves to the trash when asked to', async () => {
    await write('node_modules/a/index.js', 'x')
    const trashed: Array<string> = []

    const outcome = await deleteArtifact(root, 'node_modules', {
      moveToTrash: true,
      moveItemToTrash: async path => {
        trashed.push(path)
      },
    })

    assert.equal(outcome.kind, 'deleted')
    assert.deepEqual(trashed, [Path.join(root, 'node_modules')])
    // Trashing is the injected function's job; we did not unlink it ourselves.
    assert.equal(await exists('node_modules'), true)
  })
})
