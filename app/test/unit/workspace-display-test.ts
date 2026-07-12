import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  explainStatus,
  isCountable,
  plural,
} from '../../src/ui/workspace/display'
import {
  InventoryStatus,
  IRepositoryInventory,
} from '../../src/models/workspace-inventory'

function inventory(status: InventoryStatus): IRepositoryInventory {
  return {
    repositoryId: 1,
    repositoryPath: '/tmp/project',
    scannedAt: 0,
    status,
    contextFiles: [],
    docs: [],
    artifacts: [],
  }
}

describe('plural', () => {
  it('appends an s by default', () => {
    assert.strictEqual(plural(0, 'file'), 'files')
    assert.strictEqual(plural(1, 'file'), 'file')
    assert.strictEqual(plural(2, 'file'), 'files')
  })

  it('uses the given plural when appending an s would be wrong', () => {
    assert.strictEqual(plural(1, 'directory', 'directories'), 'directory')
    assert.strictEqual(plural(3, 'directory', 'directories'), 'directories')
    assert.strictEqual(plural(2, 'was', 'were'), 'were')
  })
})

describe('isCountable', () => {
  it('counts a scanned project', () => {
    assert.strictEqual(isCountable(inventory({ kind: 'ok' })), true)
  })

  // The whole point. A project nobody looked at is not a project with no agent
  // context, and letting it into that count makes the number a lie.
  it('does not count a project that was never scanned', () => {
    assert.strictEqual(isCountable(inventory({ kind: 'never-scanned' })), false)
  })

  it('does not count a project whose scan failed', () => {
    assert.strictEqual(
      isCountable(inventory({ kind: 'error', message: 'EACCES' })),
      false
    )
  })

  it('does not count a project that is gone from disk', () => {
    assert.strictEqual(isCountable(inventory({ kind: 'missing' })), false)
  })
})

describe('explainStatus', () => {
  it('distinguishes never-scanned from every other state', () => {
    const neverScanned = explainStatus({ kind: 'never-scanned' })
    const missing = explainStatus({ kind: 'missing' })
    const failed = explainStatus({ kind: 'error', message: 'EACCES' })

    assert.notStrictEqual(neverScanned, missing)
    assert.notStrictEqual(neverScanned, failed)
    assert.match(neverScanned, /not been scanned/i)
  })

  it('passes a scan failure through with its real message', () => {
    assert.strictEqual(
      explainStatus({ kind: 'error', message: 'EACCES: permission denied' }),
      'EACCES: permission denied'
    )
  })

  it('says nothing about a healthy project', () => {
    assert.strictEqual(explainStatus({ kind: 'ok' }), '')
  })
})
