import { describe, it } from 'node:test'
import assert from 'node:assert'
import { LineAuthorship } from '../../src/lib/diff/commit-ai-signature'
import {
  computeCollapsedRegions,
  DefaultAttributionContextLines,
  expandAll,
  expandRegion,
  IAttributableRow,
  ICollapsedRegion,
  isRowCollapsed,
  MinCollapseSize,
  summarizeAttributionCounts,
  visibleRowIndices,
} from '../../src/lib/diff/attribution-filter'

// The attribution filter's pure core (#71).
//
// Every test here builds a synthetic diff as an array of rows, hands it a plain
// authorship map (the per-line verdict from #70: `ai | non-ai | uncommitted`),
// and asserts which contiguous regions fold. No renderer, no git, no disk — the
// point of the module is that this is possible.

/** A plain line row whose diff line number equals its index, for easy mapping. */
function line(index: number): IAttributableRow {
  return { isHunkHeader: false, diffLineNumber: index }
}

/** A hunk-header row: never a target, never folded. */
function hunk(): IAttributableRow {
  return { isHunkHeader: true, diffLineNumber: null }
}

/**
 * Build `count` line rows whose diffLineNumber equals the row index, mark a set
 * of those indices `'ai'`, and give every other line the supplied verdict
 * (`'non-ai'` by default). Keeps the tests declarative.
 */
function buildDiff(
  count: number,
  aiIndices: ReadonlyArray<number>,
  rest: LineAuthorship = 'non-ai'
): {
  readonly rows: ReadonlyArray<IAttributableRow>
  readonly authorships: Map<number, LineAuthorship>
} {
  const rows: Array<IAttributableRow> = []
  const authorships = new Map<number, LineAuthorship>()
  const aiSet = new Set(aiIndices)
  for (let i = 0; i < count; i++) {
    rows.push(line(i))
    authorships.set(i, aiSet.has(i) ? 'ai' : rest)
  }
  return { rows, authorships }
}

const noAnnotations: ReadonlySet<number> = new Set<number>()

function regionsAt(
  regions: ReadonlyArray<ICollapsedRegion>
): ReadonlyArray<readonly [number, number]> {
  return regions.map(r => [r.startRowIndex, r.endRowIndex] as const)
}

describe('computeCollapsedRegions — the veracity lock', () => {
  it('folds nothing when the authorship map is empty (no verdict)', () => {
    const rows = Array.from({ length: 50 }, (_, i) => line(i))
    const regions = computeCollapsedRegions(rows, new Map(), noAnnotations, {})
    assert.deepStrictEqual(regions, [])
  })

  it("folds nothing when every line is 'uncommitted' (nothing to attribute)", () => {
    const rows = Array.from({ length: 50 }, (_, i) => line(i))
    const authorships = new Map<number, LineAuthorship>()
    for (let i = 0; i < 50; i++) {
      authorships.set(i, 'uncommitted')
    }
    const regions = computeCollapsedRegions(
      rows,
      authorships,
      noAnnotations,
      {}
    )
    assert.deepStrictEqual(regions, [])
  })

  it("folds nothing when no line is 'ai' (all committed without AI)", () => {
    const { rows, authorships } = buildDiff(80, [])
    const regions = computeCollapsedRegions(
      rows,
      authorships,
      noAnnotations,
      {}
    )
    assert.deepStrictEqual(regions, [])
  })

  it('folds nothing when 100% of lines are AI (nothing to filter)', () => {
    const all = Array.from({ length: 40 }, (_, i) => i)
    const { rows, authorships } = buildDiff(40, all)
    const regions = computeCollapsedRegions(
      rows,
      authorships,
      noAnnotations,
      {}
    )
    assert.deepStrictEqual(regions, [])
  })

  it('folds nothing for an empty row set', () => {
    const regions = computeCollapsedRegions([], new Map(), noAnnotations, {})
    assert.deepStrictEqual(regions, [])
  })
})

describe('computeCollapsedRegions — a single AI block', () => {
  it('keeps the block plus 3 context rows each side; folds the rest', () => {
    // 100 rows; the AI owns rows 48..52. Context 3 keeps 45..55.
    const aiIndices = [48, 49, 50, 51, 52]
    const { rows, authorships } = buildDiff(100, aiIndices)
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: DefaultAttributionContextLines,
    })
    // Two folds: 0..44 (before context) and 56..99 (after context).
    assert.deepStrictEqual(regionsAt(regions), [
      [0, 44],
      [56, 99],
    ])
  })
})

describe('computeCollapsedRegions — two AI blocks', () => {
  it('does NOT fold a 5-row gap between blocks (context swallows it)', () => {
    // Block A ends at row 10; block B starts at row 16 — rows 11..15 between.
    // Context 3 preserves 11,12,13 (after A) and 13,14,15 (before B): all 5.
    const { rows, authorships } = buildDiff(40, [10, 16])
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
    })
    // The only folds are the far ends; nothing between 10 and 16.
    for (const region of regions) {
      const spansGap = region.startRowIndex <= 15 && region.endRowIndex >= 11
      assert.strictEqual(
        spansGap,
        false,
        `unexpected fold across the gap: ${region.startRowIndex}..${region.endRowIndex}`
      )
    }
  })

  it('folds exactly one region of 194 rows for a 200-row gap', () => {
    // Block A at row 10, block B at row 211 — 200 rows (11..210) between.
    // Context 3 keeps 11..13 and 208..210, folding 14..207 = 194 rows.
    const { rows, authorships } = buildDiff(400, [10, 211])
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
    })
    const gapRegion = regions.find(
      r => r.startRowIndex >= 11 && r.endRowIndex <= 210
    )
    assert.notStrictEqual(gapRegion, undefined)
    assert.strictEqual(gapRegion!.startRowIndex, 14)
    assert.strictEqual(gapRegion!.endRowIndex, 207)
    assert.strictEqual(gapRegion!.lineCount, 194)
  })
})

describe('computeCollapsedRegions — MinCollapseSize', () => {
  it('does NOT fold a standalone 3-row non-AI region', () => {
    // 3 rows (0..2), then an AI block far enough that context does not reach
    // them. AI at rows 6..40; context 3 reaches down to row 3, so 0..2 stay a
    // run of length 3 < MinCollapseSize(4) and must NOT fold.
    const aiIndices = Array.from({ length: 35 }, (_, i) => i + 6)
    const { rows, authorships } = buildDiff(41, aiIndices)
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
      minCollapseSize: MinCollapseSize,
    })
    assert.deepStrictEqual(regions, [])
  })

  it('DOES fold a standalone 4-row non-AI region', () => {
    // Rows 0..3 non-AI, AI 7..40; context reaches down to row 4, so 0..3 is a
    // run of length 4 == MinCollapseSize and folds.
    const aiIndices = Array.from({ length: 34 }, (_, i) => i + 7)
    const { rows, authorships } = buildDiff(41, aiIndices)
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
      minCollapseSize: MinCollapseSize,
    })
    assert.deepStrictEqual(regionsAt(regions), [[0, 3]])
  })
})

describe('computeCollapsedRegions — never fold protected rows', () => {
  it('splits a folding region around an annotated row', () => {
    // AI block at 60..64 keeps 57..67. Row 20 is annotated. Without the
    // annotation, 0..56 would be one fold; the annotation at 20 splits it into
    // 0..19 and 21..56.
    const { rows, authorships } = buildDiff(100, [60, 61, 62, 63, 64])
    const annotated = new Set<number>([20])
    const regions = computeCollapsedRegions(rows, authorships, annotated, {
      contextLines: 3,
    })
    assert.deepStrictEqual(regionsAt(regions), [
      [0, 19],
      [21, 56],
      [68, 99],
    ])
  })

  it('never folds a hunk-header row; it splits the run', () => {
    // 0..49 line rows, a hunk header at index 50, then AI block 80..84.
    const rows: Array<IAttributableRow> = []
    const authorships = new Map<number, LineAuthorship>()
    for (let i = 0; i < 100; i++) {
      if (i === 50) {
        rows.push(hunk())
        continue
      }
      rows.push(line(i))
      authorships.set(i, i >= 80 && i <= 84 ? 'ai' : 'non-ai')
    }
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
    })
    // The header at 50 splits the leading fold into 0..49 and 51..76.
    assert.deepStrictEqual(regionsAt(regions), [
      [0, 49],
      [51, 76],
      [88, 99],
    ])
    // And the header index is never inside any region.
    assert.strictEqual(isRowCollapsed(regions, 50), false)
  })

  it("folds an 'uncommitted' line in with the non-AI rows", () => {
    // AI block 40..44. Row 10 is uncommitted (working-directory, no signature):
    // not the AI's, so collapsible, folded with its neighbours.
    const { rows, authorships } = buildDiff(80, [40, 41, 42, 43, 44])
    authorships.set(10, 'uncommitted')
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
    })
    // Row 10 is inside the leading fold, not preserved.
    assert.strictEqual(isRowCollapsed(regions, 10), true)
    assert.deepStrictEqual(regionsAt(regions), [
      [0, 36],
      [48, 79],
    ])
  })
})

describe('computeCollapsedRegions — uncommitted folds like non-AI', () => {
  it('folds a mix of non-AI and uncommitted around an AI block the same way', () => {
    // AI block at 48..52 (context keeps 45..55). Half the rest is non-AI, half
    // uncommitted — both fold identically, so the regions match the pure-non-AI
    // single-block case: 0..44 and 56..99.
    const rows: Array<IAttributableRow> = []
    const authorships = new Map<number, LineAuthorship>()
    for (let i = 0; i < 100; i++) {
      rows.push(line(i))
      if (i >= 48 && i <= 52) {
        authorships.set(i, 'ai')
      } else {
        authorships.set(i, i % 2 === 0 ? 'non-ai' : 'uncommitted')
      }
    }
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      contextLines: 3,
    })
    assert.deepStrictEqual(regionsAt(regions), [
      [0, 44],
      [56, 99],
    ])
  })
})

describe("computeCollapsedRegions — 'all' mode folds nothing", () => {
  it('keeps every row when the filter is off (show all)', () => {
    const { rows, authorships } = buildDiff(100, [48, 49, 50, 51, 52])
    const regions = computeCollapsedRegions(rows, authorships, noAnnotations, {
      mode: 'all',
      contextLines: 3,
    })
    assert.deepStrictEqual(regions, [])
  })
})

describe('expandRegion / expandAll / visibleRowIndices', () => {
  const regions: ReadonlyArray<ICollapsedRegion> = [
    { startRowIndex: 0, endRowIndex: 9, lineCount: 10 },
    { startRowIndex: 20, endRowIndex: 29, lineCount: 10 },
    { startRowIndex: 50, endRowIndex: 59, lineCount: 10 },
  ]

  it('expands exactly one region by start index, untouched otherwise', () => {
    const after = expandRegion(regions, 20)
    assert.deepStrictEqual(regionsAt(after), [
      [0, 9],
      [50, 59],
    ])
  })

  it('is a no-op for a start index that matches no region', () => {
    const after = expandRegion(regions, 21)
    assert.strictEqual(after.length, regions.length)
  })

  it('expandAll returns the empty set', () => {
    assert.deepStrictEqual(expandAll(), [])
  })

  it('visibleRowIndices omits exactly the folded rows', () => {
    const smallRegions: ReadonlyArray<ICollapsedRegion> = [
      { startRowIndex: 2, endRowIndex: 4, lineCount: 3 },
    ]
    assert.deepStrictEqual(visibleRowIndices(7, smallRegions), [0, 1, 5, 6])
  })

  it('visibleRowIndices returns all rows when nothing is folded', () => {
    assert.deepStrictEqual(visibleRowIndices(4, []), [0, 1, 2, 3])
  })
})

describe('summarizeAttributionCounts — the honest counter', () => {
  it('counts AI vs non-AI line rows, ignoring hunk headers', () => {
    // 800 line rows, 600 AI; plus 3 hunk headers that must not be counted.
    const rows: Array<IAttributableRow> = []
    const authorships = new Map<number, LineAuthorship>()
    for (let i = 0; i < 800; i++) {
      rows.push(line(i))
      authorships.set(i, i < 600 ? 'ai' : 'non-ai')
    }
    rows.push(hunk(), hunk(), hunk())
    const counts = summarizeAttributionCounts(rows, authorships)
    assert.strictEqual(counts.aiLineCount, 600)
    assert.strictEqual(counts.nonAiLineCount, 200)
    assert.strictEqual(counts.totalLineCount, 800)
  })

  it('pools uncommitted lines into the non-AI count', () => {
    // 100 rows: 40 AI, 30 non-AI, 30 uncommitted. The header says "40 with AI,
    // 60 without" — uncommitted is not the AI's either.
    const rows: Array<IAttributableRow> = []
    const authorships = new Map<number, LineAuthorship>()
    for (let i = 0; i < 100; i++) {
      rows.push(line(i))
      if (i < 40) {
        authorships.set(i, 'ai')
      } else if (i < 70) {
        authorships.set(i, 'non-ai')
      } else {
        authorships.set(i, 'uncommitted')
      }
    }
    const counts = summarizeAttributionCounts(rows, authorships)
    assert.strictEqual(counts.aiLineCount, 40)
    assert.strictEqual(counts.nonAiLineCount, 60)
    assert.strictEqual(counts.totalLineCount, 100)
  })

  it('reports zero AI when there is no verdict', () => {
    const rows = Array.from({ length: 30 }, (_, i) => line(i))
    const counts = summarizeAttributionCounts(rows, new Map())
    assert.strictEqual(counts.aiLineCount, 0)
    assert.strictEqual(counts.nonAiLineCount, 30)
    assert.strictEqual(counts.totalLineCount, 30)
  })
})
