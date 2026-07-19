import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ITextDiff,
  IImageDiff,
  DiffType,
} from '../../src/models/diff/diff-data'
import { DiffLine, DiffLineType } from '../../src/models/diff/diff-line'
import {
  DiffHunk,
  DiffHunkHeader,
  DiffHunkExpansionType,
} from '../../src/models/diff/raw-diff'
import { IDiffAnchor, createDiffAnchor } from '../../src/lib/diff/diff-anchor'
import {
  IDiffAnnotation,
  MaxAnnotationBodyLength,
  validateAnnotationBody,
  isAnnotationUnresolved,
} from '../../src/models/diff-annotation'
import {
  placeDiffAnnotations,
  unresolvedAnnotatedDiffLines,
  annotationsOnDiffLine,
  countUnresolvedAnnotations,
  reAnchorAnnotation,
} from '../../src/lib/diff/diff-annotation'

// --- Hand-built diffs, for precise control over placement --------------------

interface ILineSpec {
  readonly type: DiffLineType
  readonly old: number | null
  readonly new: number | null
  readonly body: string
}

function ctx(n: number, body: string): ILineSpec {
  return { type: DiffLineType.Context, old: n, new: n, body }
}
function add(newN: number, body: string): ILineSpec {
  return { type: DiffLineType.Add, old: null, new: newN, body }
}

function toDiffLine(spec: ILineSpec): DiffLine {
  const marker =
    spec.type === DiffLineType.Add
      ? '+'
      : spec.type === DiffLineType.Delete
      ? '-'
      : ' '
  return new DiffLine(marker + spec.body, spec.type, null, spec.old, spec.new)
}

/** Build an ITextDiff from hunks of line specs, assigning unified indices. */
function textDiff(
  ...hunks: ReadonlyArray<ReadonlyArray<ILineSpec>>
): ITextDiff {
  let unified = 0
  const built = hunks.map(specs => {
    const header = new DiffHunkHeader(1, 1, 1, 1)
    const headerLine = new DiffLine('@@', DiffLineType.Hunk, null, null, null)
    const lines = [headerLine, ...specs.map(toDiffLine)]
    const start = unified
    unified += lines.length
    return new DiffHunk(
      header,
      lines,
      start,
      unified - 1,
      DiffHunkExpansionType.None
    )
  })
  return {
    kind: DiffType.Text,
    text: '',
    hunks: built,
    maxLineNumber: unified,
    hasHiddenBidiChars: false,
  }
}

const at = (p: string): { path: string } => ({ path: p })

function annotation(
  id: number,
  anchor: IDiffAnchor,
  overrides: Partial<IDiffAnnotation> = {}
): IDiffAnnotation {
  return {
    id,
    repositoryId: 1,
    anchor,
    body: 'note ' + id,
    state: 'unresolved',
    createdAt: id,
    updatedAt: id,
    ...overrides,
  }
}

// --- Body validation ---------------------------------------------------------

describe('validateAnnotationBody', () => {
  it('accepts a normal body and returns it unchanged', () => {
    const result = validateAnnotationBody('the retry reprocesses the same item')
    assert.strictEqual(result.valid, true)
    assert.strictEqual(
      result.valid ? result.body : '',
      'the retry reprocesses the same item'
    )
  })

  it('rejects an all-whitespace body as empty — a result, not a throw', () => {
    const result = validateAnnotationBody('   \n\t  ')
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.valid ? '' : result.reason, 'empty')
  })

  it('rejects a body over the length cap', () => {
    const result = validateAnnotationBody(
      'x'.repeat(MaxAnnotationBodyLength + 1)
    )
    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.valid ? '' : result.reason, 'too-long')
  })

  it('accepts a body exactly at the length cap', () => {
    const result = validateAnnotationBody('x'.repeat(MaxAnnotationBodyLength))
    assert.strictEqual(result.valid, true)
  })
})

describe('isAnnotationUnresolved', () => {
  it('is true for the default state and false once resolved', () => {
    const diff = textDiff([ctx(1, 'a')])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    assert.strictEqual(isAnnotationUnresolved(annotation(1, anchor)), true)
    assert.strictEqual(
      isAnnotationUnresolved(annotation(2, anchor, { state: 'resolved' })),
      false
    )
  })
})

// --- Placement ---------------------------------------------------------------

describe('placeDiffAnnotations', () => {
  it('places a note on the render line of its anchored code line', () => {
    // lines: [hunk(0), ctx10(1), ctx11(2), add12(3), ctx13(4)]
    const diff = textDiff([
      ctx(10, 'a'),
      ctx(11, 'b'),
      add(12, 'c'),
      ctx(13, 'd'),
    ])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 12)!
    const layout = placeDiffAnnotations(
      [annotation(1, anchor)],
      diff,
      at('f.ts')
    )

    assert.strictEqual(layout.orphaned.length, 0)
    const onLine = annotationsOnDiffLine(layout, 3)
    assert.strictEqual(onLine.length, 1)
    assert.strictEqual(onLine[0].annotation.id, 1)
    assert.strictEqual(onLine[0].resolution.kind, 'exact')
  })

  it('returns an empty layout for no annotations', () => {
    const diff = textDiff([ctx(1, 'a')])
    const layout = placeDiffAnnotations([], diff, at('f.ts'))
    assert.strictEqual(layout.byDiffLine.size, 0)
    assert.strictEqual(layout.orphaned.length, 0)
  })

  it('keeps two notes on the same line, ordered by createdAt then id', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b')])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 2)!
    // Passed newest-first; layout must return oldest-first.
    const later = annotation(9, anchor, { createdAt: 200 })
    const earlier = annotation(4, anchor, { createdAt: 100 })
    const layout = placeDiffAnnotations([later, earlier], diff, at('f.ts'))

    const onLine = annotationsOnDiffLine(layout, 2) // ctx(2) at unified index 2
    assert.deepStrictEqual(
      onLine.map(r => r.annotation.id),
      [4, 9]
    )
  })

  it('places notes on the boundary rows — first and last line of a hunk', () => {
    const diff = textDiff([ctx(5, 'first'), ctx(6, 'mid'), ctx(7, 'last')])
    const first = createDiffAnchor(diff, 'f.ts', 'new', 5)!
    const last = createDiffAnchor(diff, 'f.ts', 'new', 7)!
    const layout = placeDiffAnnotations(
      [annotation(1, first), annotation(2, last)],
      diff,
      at('f.ts')
    )
    assert.strictEqual(annotationsOnDiffLine(layout, 1).length, 1) // first row
    assert.strictEqual(annotationsOnDiffLine(layout, 3).length, 1) // last row
  })

  it('orphans a note whose file is not this diff — never places it', () => {
    const other = textDiff([ctx(1, 'a')])
    const anchor = createDiffAnchor(other, 'other.ts', 'new', 1)!
    const diff = textDiff([ctx(1, 'a')])
    const layout = placeDiffAnnotations(
      [annotation(1, anchor)],
      diff,
      at('this.ts')
    )
    assert.strictEqual(layout.byDiffLine.size, 0)
    assert.strictEqual(layout.orphaned.length, 1)
    assert.strictEqual(layout.orphaned[0].resolution.kind, 'orphaned')
  })

  it('never throws on a non-text diff — every note orphans', () => {
    const diff = textDiff([ctx(1, 'a')])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const image: IImageDiff = { kind: DiffType.Image }
    const layout = placeDiffAnnotations(
      [annotation(1, anchor)],
      image,
      at('f.ts')
    )
    assert.strictEqual(layout.byDiffLine.size, 0)
    assert.strictEqual(layout.orphaned.length, 1)
  })
})

// --- Queries -----------------------------------------------------------------

describe('unresolvedAnnotatedDiffLines', () => {
  it('marks a line with an unresolved note and skips a resolved-only line', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b')])
    const a1 = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const a2 = createDiffAnchor(diff, 'f.ts', 'new', 2)!
    const layout = placeDiffAnnotations(
      [
        annotation(1, a1), // unresolved -> line kept
        annotation(2, a2, { state: 'resolved' }), // resolved -> line not kept
      ],
      diff,
      at('f.ts')
    )
    const lines = unresolvedAnnotatedDiffLines(layout)
    assert.strictEqual(lines.has(1), true) // ctx(1) render row
    assert.strictEqual(lines.has(2), false) // ctx(2) render row
  })

  it('keeps a line that has any unresolved note among resolved ones', () => {
    const diff = textDiff([ctx(1, 'a')])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const layout = placeDiffAnnotations(
      [
        annotation(1, anchor, { state: 'resolved' }),
        annotation(2, anchor, { state: 'unresolved' }),
      ],
      diff,
      at('f.ts')
    )
    assert.strictEqual(unresolvedAnnotatedDiffLines(layout).has(1), true)
  })
})

describe('countUnresolvedAnnotations', () => {
  it('counts only unresolved notes, independent of any diff', () => {
    const diff = textDiff([ctx(1, 'a')])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const count = countUnresolvedAnnotations([
      annotation(1, anchor),
      annotation(2, anchor, { state: 'resolved' }),
      annotation(3, anchor),
    ])
    assert.strictEqual(count, 2)
  })
})

// --- Re-anchoring ------------------------------------------------------------

describe('reAnchorAnnotation', () => {
  it('files the old anchor into previousAnchors and stamps updatedAt', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b')])
    const oldAnchor = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const newAnchor = createDiffAnchor(diff, 'f.ts', 'new', 2)!
    const original = annotation(1, oldAnchor, { updatedAt: 100 })

    const reanchored = reAnchorAnnotation(original, newAnchor, 999)

    assert.strictEqual(reanchored.anchor, newAnchor)
    assert.strictEqual(reanchored.updatedAt, 999)
    assert.deepStrictEqual(reanchored.previousAnchors, [oldAnchor])
    // The input is untouched — a pure transform.
    assert.strictEqual(original.anchor, oldAnchor)
    assert.strictEqual(original.previousAnchors, undefined)
  })

  it('appends to an existing previousAnchors trail', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b'), ctx(3, 'c')])
    const a1 = createDiffAnchor(diff, 'f.ts', 'new', 1)!
    const a2 = createDiffAnchor(diff, 'f.ts', 'new', 2)!
    const a3 = createDiffAnchor(diff, 'f.ts', 'new', 3)!
    const once = reAnchorAnnotation(
      annotation(1, a2, { previousAnchors: [a1] }),
      a3,
      5
    )
    assert.deepStrictEqual(once.previousAnchors, [a1, a2])
  })
})
