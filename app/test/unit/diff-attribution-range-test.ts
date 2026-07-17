import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IAttributionProvenance,
  IAttributionRange,
} from '../../src/models/diff-attribution'
import {
  attributionForLine,
  buildAttributionRanges,
  countClaimedLines,
  ILineSpan,
  MaxClaimedLinesPerRecord,
  mergeRangeSets,
  normalizeRanges,
  parseLineRanges,
  provenanceAt,
  rangesCoverLine,
  shiftRangesForDelete,
  shiftRangesForInsert,
  summarizeRanges,
} from '../../src/lib/diff/attribution-range'

// A tiny provenance factory, so the tests read as intent, not boilerplate.
function prov(
  agentId: string,
  sessionId: string,
  recordedAt: number
): IAttributionProvenance {
  return { agentId, sessionId, recordedAt }
}

const claude = prov('claude-code', 'a3f1c0', 1000)

function range(
  start: number,
  end: number,
  p: IAttributionProvenance = claude
): IAttributionRange {
  return { start, end, provenance: p }
}

/** Assert an operation succeeded and return its value. */
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown }
): T {
  assert.ok(result.ok, `expected ok, got error ${JSON.stringify(result)}`)
  return result.value
}

describe('parseLineRanges', () => {
  it('parses a single line', () => {
    assert.deepStrictEqual(unwrap(parseLineRanges('57')), [
      { start: 57, end: 57 },
    ])
  })

  it('parses a range', () => {
    assert.deepStrictEqual(unwrap(parseLineRanges('40-92')), [
      { start: 40, end: 92 },
    ])
  })

  it('parses several comma-separated spans with whitespace', () => {
    assert.deepStrictEqual(unwrap(parseLineRanges(' 40-92 , 100-110, 57 ')), [
      { start: 40, end: 92 },
      { start: 100, end: 110 },
      { start: 57, end: 57 },
    ])
  })

  it('returns an error, never throws, for an empty spec', () => {
    const result = parseLineRanges('   ')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'empty')
  })

  it('returns an error for a malformed token', () => {
    const result = parseLineRanges('40-92-100')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'malformed')
  })

  it('returns an error for a non-numeric token', () => {
    const result = parseLineRanges('foo')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'malformed')
  })

  it('returns an error for line 0', () => {
    const result = parseLineRanges('0-5')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'non-positive')
  })

  it('returns an error for an inverted range', () => {
    const result = parseLineRanges('92-40')
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'inverted')
  })
})

describe('buildAttributionRanges', () => {
  it('builds one range from 40-92 covering 53 lines', () => {
    const spans = unwrap(parseLineRanges('40-92'))
    const ranges = unwrap(buildAttributionRanges(spans, claude))
    assert.strictEqual(ranges.length, 1)
    assert.strictEqual(ranges[0].start, 40)
    assert.strictEqual(ranges[0].end, 92)
    assert.strictEqual(countClaimedLines(ranges), 53)
  })

  it('refuses a declaration over the cap, with a reason, without throwing', () => {
    const spans: ReadonlyArray<ILineSpan> = [
      { start: 1, end: MaxClaimedLinesPerRecord + 1 },
    ]
    const result = buildAttributionRanges(spans, claude)
    assert.strictEqual(result.ok, false)
    if (result.ok === false) {
      assert.strictEqual(result.error.kind, 'too-many-lines')
      assert.strictEqual(
        result.error.kind === 'too-many-lines' && result.error.requested,
        MaxClaimedLinesPerRecord + 1
      )
    }
  })

  it('honours a custom cap', () => {
    const spans: ReadonlyArray<ILineSpan> = [{ start: 1, end: 11 }]
    const result = buildAttributionRanges(spans, claude, 10)
    assert.strictEqual(result.ok, false)
  })

  it('accepts a declaration exactly at the cap', () => {
    const spans: ReadonlyArray<ILineSpan> = [
      { start: 1, end: MaxClaimedLinesPerRecord },
    ]
    const result = buildAttributionRanges(spans, claude)
    assert.strictEqual(result.ok, true)
  })

  it('refuses an empty span list', () => {
    const result = buildAttributionRanges([], claude)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'empty')
  })

  it('refuses an inverted span', () => {
    const result = buildAttributionRanges([{ start: 92, end: 40 }], claude)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'inverted')
  })

  it('refuses a non-positive span', () => {
    const result = buildAttributionRanges([{ start: 0, end: 5 }], claude)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.ok === false && result.error.kind, 'non-positive')
  })

  it('coalesces adjacent spans on build', () => {
    const ranges = unwrap(
      buildAttributionRanges(
        [
          { start: 1, end: 5 },
          { start: 6, end: 10 },
        ],
        claude
      )
    )
    assert.strictEqual(ranges.length, 1)
    assert.deepStrictEqual([ranges[0].start, ranges[0].end], [1, 10])
  })

  it('counts overlapping spans as a union, not a sum', () => {
    // 1-10 and 5-15 overlap; the union is 15 lines, not 21.
    const ranges = unwrap(
      buildAttributionRanges(
        [
          { start: 1, end: 10 },
          { start: 5, end: 15 },
        ],
        claude
      )
    )
    assert.strictEqual(countClaimedLines(ranges), 15)
  })
})

describe('normalizeRanges', () => {
  it('merges overlapping same-provenance ranges', () => {
    const result = normalizeRanges([range(1, 10), range(5, 15)])
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [1, 15])
  })

  it('merges adjacent same-provenance ranges', () => {
    const result = normalizeRanges([range(1, 5), range(6, 10)])
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [1, 10])
  })

  it('keeps a one-line gap as two ranges', () => {
    const result = normalizeRanges([range(1, 5), range(7, 10)])
    assert.strictEqual(result.length, 2)
  })

  it('never merges across different provenance, even when overlapping', () => {
    const other = prov('other-agent', 'zzz', 2000)
    const result = normalizeRanges([range(1, 10, claude), range(5, 15, other)])
    assert.strictEqual(result.length, 2)
  })

  it('drops invalid ranges without throwing', () => {
    const result = normalizeRanges([range(10, 5), range(0, 3)])
    assert.strictEqual(result.length, 0)
  })
})

describe('shiftRangesForInsert', () => {
  it('shifts a range down when lines are inserted above it', () => {
    // Block [40,92]; insert 10 lines occupying [10,19]. Same code, new numbers.
    const before = 60 // an interior line of the block
    const result = shiftRangesForInsert([range(40, 92)], 10, 10)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [50, 102])
    // The claim followed the code: the moved line is still agent-authored.
    assert.ok(rangesCoverLine(result, before + 10))
  })

  it('leaves a range untouched when lines are inserted below it', () => {
    const result = shiftRangesForInsert([range(40, 92)], 200, 10)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 92])
  })

  it('splits a range when the insertion lands inside it', () => {
    // Insert 3 lines at 57 inside [40,92]: the new lines are unclaimed.
    const result = shiftRangesForInsert([range(40, 92)], 57, 3)
    assert.strictEqual(result.length, 2)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 56])
    assert.deepStrictEqual([result[1].start, result[1].end], [60, 95])
    // The inserted lines carry no attribution.
    assert.strictEqual(rangesCoverLine(result, 57), false)
    assert.strictEqual(rangesCoverLine(result, 58), false)
    assert.strictEqual(rangesCoverLine(result, 59), false)
    // The code on both sides is still the agent's.
    assert.ok(rangesCoverLine(result, 56))
    assert.ok(rangesCoverLine(result, 60))
  })

  it('shifts the whole range when the insertion is exactly at its start', () => {
    const result = shiftRangesForInsert([range(40, 92)], 40, 5)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [45, 97])
  })

  it('is a no-op for a zero-line insertion', () => {
    const result = shiftRangesForInsert([range(40, 92)], 10, 0)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 92])
  })
})

describe('shiftRangesForDelete', () => {
  it('shifts a range up when lines are deleted above it', () => {
    const result = shiftRangesForDelete([range(40, 92)], 10, 5)
    assert.deepStrictEqual([result[0].start, result[0].end], [35, 87])
  })

  it('leaves a range untouched when lines are deleted below it', () => {
    const result = shiftRangesForDelete([range(40, 92)], 200, 5)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 92])
  })

  it('shrinks a range when lines are deleted from its middle', () => {
    // Delete 3 lines [57,59] from [40,92]. Head and tail rejoin, block shrinks.
    const result = shiftRangesForDelete([range(40, 92)], 57, 3)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 89])
  })

  it('drops a range entirely covered by the deletion', () => {
    const result = shiftRangesForDelete([range(40, 50)], 35, 30)
    assert.strictEqual(result.length, 0)
  })

  it('trims the head when the deletion overlaps the range end', () => {
    const result = shiftRangesForDelete([range(40, 92)], 80, 20)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 79])
  })

  it('trims the tail when the deletion overlaps the range start', () => {
    // Delete [30,45] overlapping the start of [40,92]. Surviving tail is [46,92]
    // which pulls up by 16 -> [30,76].
    const result = shiftRangesForDelete([range(40, 92)], 30, 16)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [30, 76])
  })

  it('stitches two same-provenance ranges when the deletion removes the gap between them', () => {
    // Delete [15,44], which swallows the tail of [10,20], all of the gap, and the
    // head of [40,50]. The first block's head [10,14] and the second block's tail
    // (which pulls up by 30 to [15,20]) land adjacent and, sharing provenance,
    // rejoin into a single [10,20].
    const result = shiftRangesForDelete([range(10, 20), range(40, 50)], 15, 30)
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [10, 20])
  })

  it('keeps two ranges when the deletion leaves a gap between the survivors', () => {
    // Delete only [21,24]: neither block is touched but the gap shrinks; the
    // second block pulls up by 4 to [36,46], still not adjacent to [10,20].
    const result = shiftRangesForDelete([range(10, 20), range(40, 50)], 21, 4)
    assert.strictEqual(result.length, 2)
    assert.deepStrictEqual([result[0].start, result[0].end], [10, 20])
    assert.deepStrictEqual([result[1].start, result[1].end], [36, 46])
  })

  it('is a no-op for a zero-line deletion', () => {
    const result = shiftRangesForDelete([range(40, 92)], 10, 0)
    assert.deepStrictEqual([result[0].start, result[0].end], [40, 92])
  })
})

describe('editing one claimed line', () => {
  it('drops only that line, keeping its neighbours agent-authored', () => {
    // Editing line 57 of [40,92] = delete it, insert a replacement at 57.
    const afterDelete = shiftRangesForDelete([range(40, 92)], 57, 1)
    const afterEdit = shiftRangesForInsert(afterDelete, 57, 1)
    assert.strictEqual(rangesCoverLine(afterEdit, 57), false)
    assert.ok(rangesCoverLine(afterEdit, 56))
    assert.ok(rangesCoverLine(afterEdit, 58))
    // The edited line is unknown, and specifically NOT any kind of "human".
    const attribution = attributionForLine(afterEdit, 57, true)
    assert.strictEqual(attribution.state, 'unknown')
  })
})

describe('query helpers', () => {
  it('rangesCoverLine respects inclusive boundaries', () => {
    const ranges = [range(40, 92)]
    assert.strictEqual(rangesCoverLine(ranges, 39), false)
    assert.ok(rangesCoverLine(ranges, 40))
    assert.ok(rangesCoverLine(ranges, 92))
    assert.strictEqual(rangesCoverLine(ranges, 93), false)
  })

  it('provenanceAt returns the most recent claim on an overlap', () => {
    const older = prov('claude-code', 's1', 1000)
    const newer = prov('claude-code', 's2', 2000)
    const ranges = [range(40, 92, older), range(50, 60, newer)]
    assert.strictEqual(provenanceAt(ranges, 55)?.sessionId, 's2')
    assert.strictEqual(provenanceAt(ranges, 45)?.sessionId, 's1')
    assert.strictEqual(provenanceAt(ranges, 200), null)
  })
})

describe('attributionForLine', () => {
  it('returns no-data for every line when the file has no declaration', () => {
    // Even a line that a stray range would cover must read no-data when the file
    // as a whole has no attribution data — the honest default.
    const attribution = attributionForLine([range(40, 92)], 60, false)
    assert.strictEqual(attribution.state, 'unknown')
    assert.strictEqual(
      attribution.state === 'unknown' && attribution.reason,
      'no-data'
    )
  })

  it('returns agent for a claimed line', () => {
    const attribution = attributionForLine([range(40, 92)], 60, true)
    assert.strictEqual(attribution.state, 'agent')
    if (attribution.state === 'agent') {
      assert.strictEqual(attribution.agentId, 'claude-code')
      assert.strictEqual(attribution.sessionId, 'a3f1c0')
      assert.strictEqual(attribution.lowConfidence, false)
    }
  })

  it('returns unclaimed — never human — for an uncovered line', () => {
    const attribution = attributionForLine([range(40, 92)], 200, true)
    assert.strictEqual(attribution.state, 'unknown')
    assert.strictEqual(
      attribution.state === 'unknown' && attribution.reason,
      'unclaimed'
    )
  })

  it('never yields any state other than agent or unknown', () => {
    // The structural guarantee: no code path can produce a "human" verdict.
    const ranges = [range(40, 92)]
    for (let line = 1; line <= 120; line++) {
      const attribution = attributionForLine(ranges, line, true)
      assert.ok(
        attribution.state === 'agent' || attribution.state === 'unknown',
        `line ${line} produced an unexpected state`
      )
    }
  })
})

describe('summarizeRanges', () => {
  it('reports distinct sorted agents and the union line count', () => {
    const a = prov('claude-code', 's1', 1000)
    const b = prov('aider', 's2', 2000)
    const ranges = [range(1, 10, a), range(5, 15, b), range(30, 40, a)]
    const summary = summarizeRanges(ranges, true)
    assert.deepStrictEqual(summary.agents, ['aider', 'claude-code'])
    // Union of [1,10] ∪ [5,15] ∪ [30,40] = 15 + 11 = 26 lines.
    assert.strictEqual(summary.claimedLineCount, 26)
    assert.strictEqual(summary.supersededLineCount, 0)
    assert.strictEqual(summary.hasAnyData, true)
  })

  it('passes hasAnyData through even when ranges are empty', () => {
    // A file whose every claimed line was later deleted still has "data".
    const summary = summarizeRanges([], true)
    assert.strictEqual(summary.hasAnyData, true)
    assert.strictEqual(summary.claimedLineCount, 0)
    assert.deepStrictEqual(summary.agents, [])
  })
})

describe('mergeRangeSets', () => {
  it('combines and normalizes two sets', () => {
    const result = mergeRangeSets([range(1, 5)], [range(6, 10)])
    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual([result[0].start, result[0].end], [1, 10])
  })
})
