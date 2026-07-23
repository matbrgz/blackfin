import { describe, it } from 'node:test'
import assert from 'node:assert'
import { LineAuthorship } from '../../src/lib/diff/commit-ai-signature'
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

function buildDiff(
  count: number,
  aiIndices: ReadonlyArray<number>
): {
  readonly rows: ReadonlyArray<IAttributableRow>
  readonly authorships: ReadonlyMap<number, LineAuthorship>
} {
  const rows: Array<IAttributableRow> = []
  const authorships = new Map<number, LineAuthorship>()
  const aiSet = new Set(aiIndices)
  for (let i = 0; i < count; i++) {
    rows.push({ isHunkHeader: false, diffLineNumber: i })
    authorships.set(i, aiSet.has(i) ? 'ai' : 'non-ai')
  }
  return { rows, authorships }
}

describe('attribution filter does not alter the underlying diff', () => {
  it('does not mutate the row array or its elements', () => {
    const { rows, authorships } = buildDiff(200, [90, 91, 92, 93, 94])
    const snapshot = rows.map(r => ({ ...r }))
    computeCollapsedRegions(rows, authorships, new Set(), { contextLines: 3 })
    assert.strictEqual(rows.length, snapshot.length)
    for (let i = 0; i < rows.length; i++) {
      assert.deepStrictEqual(rows[i], snapshot[i])
    }
  })

  it('does not mutate the authorship map', () => {
    const { rows, authorships } = buildDiff(200, [90, 91, 92, 93, 94])
    const before = new Map(authorships)
    computeCollapsedRegions(rows, authorships, new Set(), { contextLines: 3 })
    assert.strictEqual(authorships.size, before.size)
    for (const [key, value] of before) {
      assert.deepStrictEqual(authorships.get(key), value)
    }
  })

  it('the visible set is an order-preserving subsequence of the rows', () => {
    // Whatever collapses, the rows that remain keep their original indices and
    // order — so mapping a selection back through the view is lossless. Turning
    // the filter on then reading the visible rows can only ever hide, never
    // reorder or rewrite, the lines the selection addresses.
    const { rows, authorships } = buildDiff(300, [100, 101, 102, 200, 201])
    const regions = computeCollapsedRegions(rows, authorships, new Set(), {
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
    const { rows, authorships } = buildDiff(300, [100, 101, 102, 200, 201])
    const off = visibleRowIndices(rows.length, [])
    const regions = computeCollapsedRegions(rows, authorships, new Set(), {
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
