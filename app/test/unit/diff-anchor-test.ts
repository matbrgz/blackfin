import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import * as os from 'os'
import { mkdtemp, writeFile } from 'fs/promises'
import { exec } from 'dugite'
import { DiffParser } from '../../src/lib/diff-parser'
import { expandTextDiffHunk } from '../../src/ui/diff/text-diff-expansion'
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
import {
  anchorResolutionToDiffLineNumber,
  computeContentHash,
  createDiffAnchor,
  MaxContentPreviewLength,
  resolveDiffAnchor,
  resolveDiffAnchors,
} from '../../src/lib/diff/diff-anchor'

// --- Hand-built diffs, for precise control over the resolution cases ---------

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
function del(oldN: number, body: string): ILineSpec {
  return { type: DiffLineType.Delete, old: oldN, new: null, body }
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

describe('createDiffAnchor', () => {
  it('captures the anchored line and both file numbers', () => {
    const diff = textDiff([
      ctx(10, 'a'),
      ctx(11, 'b'),
      add(12, 'c'),
      ctx(13, 'd'),
    ])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 12)
    assert.ok(anchor !== null)
    assert.strictEqual(anchor.newLineNumber, 12)
    assert.strictEqual(anchor.oldLineNumber, null) // an Add exists only on new
    assert.strictEqual(anchor.contentHash, computeContentHash('c'))
  })

  it('returns null for a line number absent on that side', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b')])
    assert.strictEqual(createDiffAnchor(diff, 'f.ts', 'new', 99), null)
  })

  it('returns null — never throws — for a non-text diff', () => {
    const image: IImageDiff = { kind: DiffType.Image }
    assert.strictEqual(createDiffAnchor(image, 'f.png', 'new', 1), null)
  })

  it('truncates a very long preview', () => {
    const long = 'x'.repeat(5000)
    const diff = textDiff([ctx(1, long)])
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 1)
    assert.ok(anchor !== null)
    assert.strictEqual(anchor.contentPreview.length, MaxContentPreviewLength)
  })
})

describe('normalization', () => {
  it('hashes a CRLF line and an LF line identically', () => {
    assert.strictEqual(computeContentHash('foo\r'), computeContentHash('foo'))
  })

  it('hashes differently-indented lines differently', () => {
    assert.notStrictEqual(
      computeContentHash('  foo'),
      computeContentHash('    foo')
    )
  })

  it('produces a deterministic context hash at the top of a file', () => {
    // Line 1 has no real neighbours above; the window is sentinel-padded, and
    // must hash the same every time.
    const build = () =>
      createDiffAnchor(
        textDiff([ctx(1, 'first'), ctx(2, 'second')]),
        'f.ts',
        'new',
        1
      )
    const a = build()
    const b = build()
    assert.ok(a !== null && b !== null)
    assert.strictEqual(a.contextHash, b.contextHash)
  })
})

describe('resolveDiffAnchor — tiers', () => {
  const base = () =>
    textDiff([
      ctx(1, 'one'),
      ctx(2, 'two'),
      ctx(3, 'three'),
      ctx(4, 'FOUR'),
      ctx(5, 'five'),
      ctx(6, 'six'),
      ctx(7, 'seven'),
    ])

  it('resolves exactly when the line and its context are unchanged', () => {
    const diff = base()
    const anchor = createDiffAnchor(diff, 'f.ts', 'new', 4)!
    const res = resolveDiffAnchor(anchor, diff, at('f.ts'))
    assert.strictEqual(res.kind, 'exact')
    assert.strictEqual(res.kind === 'exact' ? res.lineNumber : -1, 4)
  })

  it('reports a line moved by an insertion above as moved', () => {
    const anchor = createDiffAnchor(base(), 'f.ts', 'new', 4)!
    // The same seven lines, shifted down by 10 (someone inserted 10 lines above).
    const shifted = textDiff([
      ctx(11, 'one'),
      ctx(12, 'two'),
      ctx(13, 'three'),
      ctx(14, 'FOUR'),
      ctx(15, 'five'),
      ctx(16, 'six'),
      ctx(17, 'seven'),
    ])
    const res = resolveDiffAnchor(anchor, shifted, at('f.ts'))
    assert.strictEqual(res.kind, 'moved')
    if (res.kind === 'moved') {
      assert.strictEqual(res.lineNumber, 14)
      assert.strictEqual(res.previousLineNumber, 4)
      assert.strictEqual(res.ambiguous, false)
    }
  })

  it('orphans a deleted line rather than picking another', () => {
    const anchor = createDiffAnchor(base(), 'f.ts', 'new', 4)!
    // 'FOUR' is gone; everything else remains.
    const without = textDiff([
      ctx(1, 'one'),
      ctx(2, 'two'),
      ctx(3, 'three'),
      ctx(4, 'five'),
      ctx(5, 'six'),
      ctx(6, 'seven'),
    ])
    const res = resolveDiffAnchor(anchor, without, at('f.ts'))
    assert.deepStrictEqual(res, { kind: 'orphaned', reason: 'content-gone' })
  })

  it('degrades to shifted when only the content still matches', () => {
    const anchor = createDiffAnchor(base(), 'f.ts', 'new', 4)!
    // 'FOUR' is still at line 4, but its neighbours were rewritten.
    const rewritten = textDiff([
      ctx(1, 'ONE!'),
      ctx(2, 'TWO!'),
      ctx(3, 'THREE!'),
      ctx(4, 'FOUR'),
      ctx(5, 'FIVE!'),
      ctx(6, 'SIX!'),
      ctx(7, 'SEVEN!'),
    ])
    const res = resolveDiffAnchor(anchor, rewritten, at('f.ts'))
    assert.strictEqual(res.kind, 'shifted')
    assert.strictEqual(res.kind === 'shifted' ? res.lineNumber : -1, 4)
  })

  it('orphans an ambiguous line — a lone brace among many', () => {
    // Anchor a `}` with a specific context.
    const original = textDiff([
      ctx(1, 'if (x) {'),
      ctx(2, '  work()'),
      ctx(3, '}'),
      ctx(4, 'tail'),
    ])
    const anchor = createDiffAnchor(original, 'f.ts', 'new', 3)!
    // Now many braces, none at line 3, none with the original context.
    const braces = textDiff([
      ctx(10, '}'),
      ctx(11, '}'),
      ctx(12, '}'),
      ctx(13, '}'),
    ])
    const res = resolveDiffAnchor(anchor, braces, at('f.ts'))
    assert.deepStrictEqual(res, { kind: 'orphaned', reason: 'ambiguous' })
  })

  it('picks the nearest of a duplicated block, flagged ambiguous', () => {
    // Two blocks whose anchored line has an *identical* 3-line window on both
    // sides — so their context hashes truly collide. Anchor the second `dup`.
    const block = (base: number): ReadonlyArray<ILineSpec> => [
      ctx(base + 0, 'g1'),
      ctx(base + 1, 'g2'),
      ctx(base + 2, 'g3'),
      ctx(base + 3, 'dup'),
      ctx(base + 4, 'h1'),
      ctx(base + 5, 'h2'),
      ctx(base + 6, 'h3'),
    ]
    const original = textDiff([...block(1), ctx(8, 'sep'), ...block(9)])
    // The second dup is at line 12; its window and the first dup's window match.
    const anchor = createDiffAnchor(original, 'f.ts', 'new', 12)!

    // Everything shifts by 5; the recorded line 12 no longer holds 'dup'.
    const moved = textDiff([...block(6), ctx(13, 'sep'), ...block(14)])
    const res = resolveDiffAnchor(anchor, moved, at('f.ts'))
    assert.strictEqual(res.kind, 'moved')
    if (res.kind === 'moved') {
      assert.strictEqual(res.ambiguous, true)
      // dups now sit at lines 9 and 17; 9 is nearer to the recorded 12.
      assert.strictEqual(res.lineNumber, 9)
    }
  })

  it('finds a line moved beyond the nearby window by scanning the file', () => {
    const anchor = createDiffAnchor(base(), 'f.ts', 'new', 4)!
    // Shift the whole block by 200 — well past ±64.
    const far = textDiff([
      ctx(201, 'one'),
      ctx(202, 'two'),
      ctx(203, 'three'),
      ctx(204, 'FOUR'),
      ctx(205, 'five'),
      ctx(206, 'six'),
      ctx(207, 'seven'),
    ])
    const res = resolveDiffAnchor(anchor, far, at('f.ts'))
    assert.strictEqual(res.kind, 'moved')
    if (res.kind === 'moved') {
      assert.strictEqual(res.lineNumber, 204)
      assert.strictEqual(res.ambiguous, false)
    }
  })
})

describe('resolveDiffAnchor — file and side', () => {
  it('orphans when the file is no longer in the diff', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b')])
    const anchor = createDiffAnchor(diff, 'old-name.ts', 'new', 1)!
    const res = resolveDiffAnchor(anchor, diff, at('other.ts'))
    assert.deepStrictEqual(res, { kind: 'orphaned', reason: 'file-absent' })
  })

  it('resolves across a rename when renamedFrom is given', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b'), ctx(3, 'c')])
    const anchor = createDiffAnchor(diff, 'old-name.ts', 'new', 2)!
    const res = resolveDiffAnchor(anchor, diff, {
      path: 'new-name.ts',
      renamedFrom: 'old-name.ts',
    })
    assert.strictEqual(res.kind, 'exact')
  })

  it('orphans an old-side anchor on a file that is now a pure addition', () => {
    const anchor = createDiffAnchor(
      textDiff([del(5, 'gone'), del(6, 'also gone')]),
      'f.ts',
      'old',
      5
    )!
    const pureAdd = textDiff([add(1, 'brand'), add(2, 'new')])
    const res = resolveDiffAnchor(anchor, pureAdd, at('f.ts'))
    assert.deepStrictEqual(res, { kind: 'orphaned', reason: 'side-absent' })
  })

  it('orphans against a non-text diff', () => {
    const anchor = createDiffAnchor(textDiff([ctx(1, 'a')]), 'f.ts', 'new', 1)!
    const image: IImageDiff = { kind: DiffType.Image }
    assert.deepStrictEqual(resolveDiffAnchor(anchor, image, at('f.ts')), {
      kind: 'orphaned',
      reason: 'unsupported-diff',
    })
  })
})

describe('resolveDiffAnchors — batch', () => {
  it('matches N individual calls', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b'), ctx(3, 'c'), ctx(4, 'd')])
    const anchors = [
      createDiffAnchor(diff, 'f.ts', 'new', 1)!,
      createDiffAnchor(diff, 'f.ts', 'new', 3)!,
      createDiffAnchor(diff, 'other.ts', 'new', 2)!,
    ]
    const batch = resolveDiffAnchors(anchors, diff, at('f.ts'))
    const individual = anchors.map(a => resolveDiffAnchor(a, diff, at('f.ts')))
    assert.deepStrictEqual(batch, individual)
  })
})

describe('anchorResolutionToDiffLineNumber', () => {
  it('is null for an orphan', () => {
    const diff = textDiff([ctx(1, 'a')])
    assert.strictEqual(
      anchorResolutionToDiffLineNumber(
        { kind: 'orphaned', reason: 'content-gone' },
        diff,
        'new'
      ),
      null
    )
  })

  it('returns the unified index of the resolved line', () => {
    const diff = textDiff([ctx(1, 'a'), ctx(2, 'b'), ctx(3, 'c')])
    // hunk starts at unified 0; header is index 0, so line 2 (new) is index 2.
    const n = anchorResolutionToDiffLineNumber(
      { kind: 'exact', lineNumber: 2 },
      diff,
      'new'
    )
    assert.strictEqual(n, 2)
  })
})

// --- The regression the whole issue exists for: real git diff + expansion ----

interface IPreparedDiff {
  readonly textDiff: ITextDiff
  readonly newContentLines: ReadonlyArray<string>
}

async function prepareTwoHunkDiff(): Promise<IPreparedDiff> {
  // 200 numbered lines, with an inserted line near the top and near the bottom,
  // far enough apart that git emits two separate hunks.
  const lines = [...Array(200).keys()].map(v => `line-${v}`)
  const original = lines.join('\n')
  lines.splice(150, 0, 'INSERTED-BOTTOM')
  lines.splice(20, 0, 'INSERTED-TOP')
  const modified = lines.join('\n')

  const folder = await mkdtemp(path.join(os.tmpdir(), 'diff-anchor-test'))
  await writeFile(path.join(folder, 'original'), original)
  await writeFile(path.join(folder, 'changed'), modified)

  const result = await exec(
    [
      'diff',
      '-U3',
      path.join(folder, 'original'),
      path.join(folder, 'changed'),
    ],
    folder
  )

  const diff = new DiffParser().parse(result.stdout)
  return {
    textDiff: {
      kind: DiffType.Text,
      text: diff.contents,
      hunks: diff.hunks,
      maxLineNumber: diff.maxLineNumber,
      hasHiddenBidiChars: diff.hasHiddenBidiChars,
    },
    newContentLines: lines,
  }
}

/** A Context line in the last hunk, on the new side. */
function lineInLastHunk(diff: ITextDiff): DiffLine {
  const hunk = diff.hunks[diff.hunks.length - 1]
  const line = hunk.lines.find(
    l => l.type === DiffLineType.Context && l.newLineNumber !== null
  )
  assert.ok(line !== undefined, 'expected a context line in the last hunk')
  return line
}

describe('regression: expanding a hunk above an anchor does not move it', () => {
  it('resolves exact after expansion, though diffLineNumber itself changed', async () => {
    const { textDiff: diff, newContentLines } = await prepareTwoHunkDiff()
    assert.ok(diff.hunks.length >= 2, 'fixture must produce two hunks')

    const anchored = lineInLastHunk(diff)
    const lineNumber = anchored.newLineNumber!
    const anchor = createDiffAnchor(diff, 'changed', 'new', lineNumber)
    assert.ok(anchor !== null)

    const before = resolveDiffAnchor(anchor, diff, at('changed'))
    assert.strictEqual(before.kind, 'exact')
    const diffLineBefore = anchorResolutionToDiffLineNumber(before, diff, 'new')

    // Expand the FIRST hunk upward — far from the anchored line.
    const expanded = expandTextDiffHunk(
      diff,
      diff.hunks[0],
      'up',
      newContentLines
    )
    assert.ok(expanded !== undefined, 'expansion should succeed')

    const after = resolveDiffAnchor(anchor, expanded, at('changed'))
    assert.strictEqual(after.kind, 'exact')
    assert.strictEqual(
      after.kind === 'exact' ? after.lineNumber : -1,
      lineNumber,
      'the anchor stays on the same file line'
    )

    // The control: the naive render index DID move, which is the bug the anchor
    // avoids. If these were equal the test would prove nothing.
    const diffLineAfter = anchorResolutionToDiffLineNumber(
      after,
      expanded,
      'new'
    )
    assert.notStrictEqual(diffLineBefore, diffLineAfter)
  })

  it('does not orphan when expansion reveals new context around the anchor', async () => {
    const { textDiff: diff, newContentLines } = await prepareTwoHunkDiff()
    // Anchor the first line of the LAST hunk — the one most likely to have its
    // upward context revealed by expanding that hunk up.
    const lastHunk = diff.hunks[diff.hunks.length - 1]
    const firstContext = lastHunk.lines.find(
      l => l.type === DiffLineType.Context && l.newLineNumber !== null
    )!
    const anchor = createDiffAnchor(
      diff,
      'changed',
      'new',
      firstContext.newLineNumber!
    )!

    const expanded = expandTextDiffHunk(diff, lastHunk, 'up', newContentLines)
    assert.ok(expanded !== undefined)

    const res = resolveDiffAnchor(anchor, expanded, at('changed'))
    assert.notStrictEqual(res.kind, 'orphaned')
  })
})
