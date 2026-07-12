import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { WorkspaceDatabase } from '../../src/lib/databases/workspace-database'
import { WorkspaceStore } from '../../src/lib/stores/workspace-store'

let root: string
let db: WorkspaceDatabase
let store: WorkspaceStore
let dbCount = 0

async function repo(
  name: string,
  files: Record<string, string>
): Promise<string> {
  const path = Path.join(root, name)
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = Path.join(path, relativePath)
    await mkdir(Path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
  }
  return path
}

describe('WorkspaceStore', () => {
  beforeEach(async () => {
    root = await mkdtemp(Path.join(tmpdir(), 'blackfin-store-'))
    db = new WorkspaceDatabase(`workspace-test-${dbCount++}`)
    store = new WorkspaceStore(db, () => 1234)
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('scans every repository and reports progress', async () => {
    const a = await repo('a', { 'CLAUDE.md': '# A\n' })
    const b = await repo('b', { 'AGENTS.md': '# B\n' })

    const seen: Array<number> = []
    store.onDidUpdate(() => seen.push(store.getProgress().completed))

    await store.rescanAll([
      { id: 1, path: a },
      { id: 2, path: b },
    ])

    assert.equal(store.getInventories().size, 2)
    assert.equal(
      store.getInventory(1)?.contextFiles[0].relativePath,
      'CLAUDE.md'
    )
    assert.equal(
      store.getInventory(2)?.contextFiles[0].relativePath,
      'AGENTS.md'
    )

    // Emitted as each repository landed, not once at the end — which is what
    // lets the screen fill in progressively.
    assert.ok(seen.includes(1))
    assert.deepEqual(store.getProgress(), {
      scanning: false,
      completed: 2,
      total: 2,
    })
  })

  it('paints from the cache without touching the disk again', async () => {
    const a = await repo('a', { 'CLAUDE.md': '# A\n' })
    await store.rescanAll([{ id: 1, path: a }])

    // A brand new store, same database. It must come back full.
    const revived = new WorkspaceStore(db, () => 5678)
    assert.equal(revived.getInventories().size, 0)

    await revived.loadFromCache()

    assert.equal(revived.getInventory(1)?.contextFiles.length, 1)
    // The cached scan's timestamp, not a fresh one — proving it was read rather
    // than recomputed.
    assert.equal(revived.getInventory(1)?.scannedAt, 1234)
  })

  it('forgets repositories the user has removed', async () => {
    const a = await repo('a', { 'CLAUDE.md': '# A\n' })
    const b = await repo('b', { 'CLAUDE.md': '# B\n' })

    await store.rescanAll([
      { id: 1, path: a },
      { id: 2, path: b },
    ])
    assert.equal(store.getInventories().size, 2)

    await store.rescanAll([{ id: 1, path: a }])

    assert.equal(store.getInventories().size, 1)
    assert.equal(store.getInventory(2), null)

    // And it's gone from disk too, rather than lurking to reappear on restart.
    const revived = new WorkspaceStore(db)
    await revived.loadFromCache()
    assert.equal(revived.getInventories().size, 1)
  })

  it('records a missing repository without abandoning the others', async () => {
    const a = await repo('a', { 'CLAUDE.md': '# A\n' })

    await store.rescanAll([
      { id: 1, path: Path.join(root, 'gone') },
      { id: 2, path: a },
    ])

    assert.deepEqual(store.getInventory(1)?.status, { kind: 'missing' })
    assert.deepEqual(store.getInventory(2)?.status, { kind: 'ok' })
  })

  it('deletes artifacts and rescans so the reported size is real', async () => {
    const a = await repo('a', {
      'package.json': '{}',
      'node_modules/x/index.js': 'x'.repeat(100),
    })

    await store.rescanAll([{ id: 1, path: a }])
    assert.equal(store.getInventory(1)?.artifacts.length, 1)

    const outcomes = await store.cleanUp({ id: 1, path: a }, ['node_modules'], {
      moveToTrash: false,
      moveItemToTrash: async () => {
        throw new Error('should not be called')
      },
    })

    assert.deepEqual(outcomes, [
      { kind: 'deleted', relativePath: 'node_modules' },
    ])
    // The inventory reflects the disk, rather than still claiming 100 bytes are
    // reclaimable from a directory that no longer exists.
    assert.deepEqual(store.getInventory(1)?.artifacts, [])
  })

  it('refuses to delete a source directory and says so', async () => {
    const a = await repo('a', { 'src/index.ts': 'x' })
    await store.rescanAll([{ id: 1, path: a }])

    const outcomes = await store.cleanUp({ id: 1, path: a }, ['src'], {
      moveToTrash: false,
      moveItemToTrash: async () => {},
    })

    assert.equal(outcomes[0].kind, 'refused')
  })
})
