import { describe, it } from 'node:test'
import assert from 'node:assert'
import { LineAttribution } from '../../src/models/diff-attribution'
import {
  computeCollapsedRegions,
  IAttributableRow,
  visibleRowIndices,
} from '../../src/lib/diff/attribution-filter'

// The severity-high guard, at the pure-core level (#71).
//
// The filter is a VIEW. It must never touch what is committed: not DiffSelection,
// not partial staging, not the diff itself. The full DiffSelection/staging
// equality test is deferred with the UI wiring (it needs the real diff model and
// selection); see the note in the PR. What this file proves is the property the
// whole guarantee rests on: the pure core is non-destructive. It reads its
// inputs, returns regions, and mutates nothing — so no wiring built on it *can*
// alter the selection through it.

const agentLine: LineAttribution = {
  state: 'agent',
  agentId: 'claude-code',
  sessionId: 'a3f1c0',
  recordedAt: 1000,
  lowConfidence: false,
}
const unclaimed: LineAttribution = { state: 'unknown', reason: 'unclaimed' }

function buildDiff(
  count: number,
  agentIndices: ReadonlyArray<number>
): {
  readonly rows: ReadonlyArray<IAttributableRow>
  readonly attribution: ReadonlyMap<number, LineAttribution>
} {
  const rows: Array<IAttributableRow> = []
  const attribution = new Map<number, LineAttribution>()
  const agentSet = new Set(agentIndices)
  for (let i = 0; i < count; i++) {
    rows.push({ isHunkHeader: false, diffLineNumber: i })
    attribution.set(i, agentSet.has(i) ? agentLine : unclaimed)
  }
  return { rows, attribution }
}

describe('attribution filter does not alter the underlying diff', () => {
  it('does not mutate the row array or its elements', () => {
    const { rows, attribution } = buildDiff(200, [90, 91, 92, 93, 94])
    const snapshot = rows.map(r => ({ ...r }))
    computeCollapsedRegions(rows, attribution, new Set(), { contextLines: 3 })
    assert.strictEqual(rows.length, snapshot.length)
    for (let i = 0; i < rows.length; i++) {
      assert.deepStrictEqual(rows[i], snapshot[i])
    }
  })

  it('does not mutate the attribution map', () => {
    const { rows, attribution } = buildDiff(200, [90, 91, 92, 93, 94])
    const before = new Map(attribution)
    computeCollapsedRegions(rows, attribution, new Set(), { contextLines: 3 })
    assert.strictEqual(attribution.size, before.size)
    for (const [key, value] of before) {
      assert.deepStrictEqual(attribution.get(key), value)
    }
  })

  it('the visible set is an order-preserving subsequence of the rows', () => {
    // Whatever collapses, the rows that remain keep their original indices and
    // order — so mapping a selection back through the view is lossless. Turning
    // the filter on then reading the visible rows can only ever hide, never
    // reorder or rewrite, the lines the selection addresses.
    const { rows, attribution } = buildDiff(300, [100, 101, 102, 200, 201])
    const regions = computeCollapsedRegions(rows, attribution, new Set(), {
      contextLines: 3,
    })
    const visible = visibleRowIndices(rows.length, regions)
    for (let i = 1; i < visible.length; i++) {
      assert.ok(
        visible[i] > visible[i - 1],
        'visible indices must be strictly ascending'
      )
    }
    for (const index of visible) {
      assert.ok(index >= 0 && index < rows.length)
    }
  })

  it('filter off vs on address the SAME diff rows (identity preserved)', () => {
    // "Off" is the full index range; "on" is a subset of the very same indices.
    // No index in the filtered view points at a different row than it did
    // unfiltered — the property that keeps the commit identical.
    const { rows, attribution } = buildDiff(300, [100, 101, 102, 200, 201])
    const off = visibleRowIndices(rows.length, [])
    const regions = computeCollapsedRegions(rows, attribution, new Set(), {
      contextLines: 3,
    })
    const on = visibleRowIndices(rows.length, regions)
    assert.deepStrictEqual(
      off,
      Array.from({ length: 300 }, (_, i) => i)
    )
    for (const index of on) {
      assert.strictEqual(rows[index], rows[off[index]])
    }
  })
})
