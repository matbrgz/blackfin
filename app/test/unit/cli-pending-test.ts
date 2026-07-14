import { describe, it } from 'node:test'
import assert from 'node:assert'
import { PendingRequests } from '../../src/lib/cli/pending'

describe('PendingRequests', () => {
  it('registers and settles a request exactly once', () => {
    const p = new PendingRequests<number>()
    assert.strictEqual(p.register('a', 1), true)
    assert.strictEqual(p.size, 1)
    assert.strictEqual(p.settle('a'), 1)
    assert.strictEqual(p.size, 0)
    // Settling again yields nothing — a late/duplicate response is discarded.
    assert.strictEqual(p.settle('a'), undefined)
  })

  it('refuses a duplicate id without overwriting the first', () => {
    const p = new PendingRequests<number>()
    p.register('a', 1)
    assert.strictEqual(p.register('a', 2), false)
    // The original value survives; the duplicate did not strand it.
    assert.strictEqual(p.settle('a'), 1)
  })

  it('returns undefined for an unknown id', () => {
    const p = new PendingRequests<number>()
    assert.strictEqual(p.settle('nope'), undefined)
    assert.strictEqual(p.has('nope'), false)
  })

  it('keeps concurrent requests independent', () => {
    const p = new PendingRequests<string>()
    p.register('a', 'ra')
    p.register('b', 'rb')
    assert.strictEqual(p.size, 2)
    // Settling b does not disturb a — no id crosstalk.
    assert.strictEqual(p.settle('b'), 'rb')
    assert.strictEqual(p.has('a'), true)
    assert.strictEqual(p.settle('a'), 'ra')
  })

  it('drains every pending entry for shutdown', () => {
    const p = new PendingRequests<number>()
    p.register('a', 1)
    p.register('b', 2)
    const drained = [...p.drain()].sort()
    assert.deepStrictEqual(drained, [1, 2])
    assert.strictEqual(p.size, 0)
  })
})
