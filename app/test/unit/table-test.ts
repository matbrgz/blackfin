import { describe, it } from 'node:test'
import assert from 'node:assert'
import { sensitiveDisplay } from '../../src/ui/lib/table'

describe('sensitive value cell', () => {
  it('names each state', () => {
    assert.strictEqual(sensitiveDisplay({ state: 'configured' }), 'Configured')
    assert.strictEqual(sensitiveDisplay({ state: 'absent' }), 'Not set')
    assert.strictEqual(sensitiveDisplay({ state: 'inherited' }), 'Inherited')
    assert.strictEqual(
      sensitiveDisplay({ state: 'external' }),
      'Stored externally'
    )
  })

  // The rule the table exists to enforce: a secret's *state* is shown, never
  // its value — even when a value reaches the cell by mistake.
  it('shows the state and never the value, even when a value is passed', () => {
    const secret = 'sk-live-super-secret-key-do-not-print'
    const shown = sensitiveDisplay({ state: 'configured', value: secret })

    assert.strictEqual(shown, 'Configured')
    assert.ok(
      !shown.includes(secret),
      'the rendered text must not contain the secret value'
    )
    assert.ok(!shown.includes('sk-'), 'not even a fragment of the value leaks')
  })
})
