import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import * as os from 'os'
import { mkdtemp, writeFile } from 'fs/promises'
import { exec } from 'dugite'
import { DiffParser } from '../../src/lib/diff-parser'
import { expandTextDiffHunk } from '../../src/ui/diff/text-diff-expansion'
import { ITextDiff, DiffType } from '../../src/models/diff/diff-data'
import { DiffLine, DiffLineType } from '../../src/models/diff/diff-line'
import {
  DiffHunk,
  DiffHunkHeader,
  DiffHunkExpansionType,
} from '../../src/models/diff/raw-diff'
import {
  IDiffAnchor,
  anchorResolutionToDiffLineNumber,
  createDiffAnchor,
  resolveDiffAnchor,
} from '../../src/lib/diff/diff-anchor'
import { IDiffAnnotation } from '../../src/models/diff-annotation'
import {
  placeDiffAnnotations,
  annotationsOnDiffLine,
} from '../../src/lib/diff/diff-annotation'

const at = (p: string): { path: string } => ({ path: p })

function annotation(id: number, anchor: IDiffAnchor): IDiffAnnotation {
  return {
    id,
    repositoryId: 1,
    anchor,
    body: 'note ' + id,
    state: 'unresolved',
    createdAt: id,
    updatedAt: id,
  }
}

// --- The regression the whole feature exists to survive ----------------------
//
// A real two-hunk git diff, an annotation on a line in the last hunk, then the
// FIRST hunk expanded upward — which renumbers every render index below it. The
// annotation must stay on the same *code* line; the test proves the naive index
// moved, so the anchor is doing real work.

interface IPreparedDiff {
  readonly textDiff: ITextDiff
  readonly newContentLines: ReadonlyArray<string>
}

async function prepareTwoHunkDiff(): Promise<IPreparedDiff> {
  const lines = [...Array(200).keys()].map(v => `line-${v}`)
  const original = lines.join('\n')
  lines.splice(150, 0, 'INSERTED-BOTTOM')
  lines.splice(20, 0, 'INSERTED-TOP')
  const modified = lines.join('\n')

  const folder = await mkdtemp(path.join(os.tmpdir(), 'diff-annotation-test'))
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

describe('annotation placement survives a hunk expansion above it', () => {
  it('keeps the note on the same code line though its render index moved', async () => {
    const { textDiff: diff, newContentLines } = await prepareTwoHunkDiff()
    assert.ok(diff.hunks.length >= 2, 'fixture must produce two hunks')

    const anchored = lineInLastHunk(diff)
    const codeLine = anchored.newLineNumber!
    const anchor = createDiffAnchor(diff, 'changed', 'new', codeLine)!
    const ann = annotation(1, anchor)

    const before = placeDiffAnnotations([ann], diff, at('changed'))
    const diffLineBefore = anchorResolutionToDiffLineNumber(
      resolveDiffAnchor(anchor, diff, at('changed')),
      diff,
      'new'
    )!
    // Present, exact, on that render row before expansion.
    assert.strictEqual(before.orphaned.length, 0)
    assert.strictEqual(
      annotationsOnDiffLine(before, diffLineBefore)[0].annotation.id,
      1
    )

    // Expand the FIRST hunk upward — nowhere near the annotated line.
    const expanded = expandTextDiffHunk(
      diff,
      diff.hunks[0],
      'up',
      newContentLines
    )
    assert.ok(expanded !== undefined, 'expansion should succeed')

    const after = placeDiffAnnotations([ann], expanded, at('changed'))
    assert.strictEqual(after.orphaned.length, 0, 'the note is not orphaned')

    const resAfter = resolveDiffAnchor(anchor, expanded, at('changed'))
    assert.strictEqual(resAfter.kind, 'exact')
    assert.strictEqual(
      resAfter.kind === 'exact' ? resAfter.lineNumber : -1,
      codeLine,
      'still the same code line'
    )

    // The map was rebuilt against the new render: the note now sits on a
    // DIFFERENT render row than before, and it is really there.
    const diffLineAfter = anchorResolutionToDiffLineNumber(
      resAfter,
      expanded,
      'new'
    )!
    assert.notStrictEqual(
      diffLineBefore,
      diffLineAfter,
      'the naive render index moved — the anchor is what saved the note'
    )
    assert.strictEqual(
      annotationsOnDiffLine(after, diffLineAfter)[0].annotation.id,
      1
    )
  })
})

// --- Hand-built diffs for the orphan and batch cases -------------------------

interface ILineSpec {
  readonly type: DiffLineType
  readonly old: number | null
  readonly new: number | null
  readonly body: string
}
const ctx = (n: number, body: string): ILineSpec => ({
  type: DiffLineType.Context,
  old: n,
  new: n,
  body,
})
const add = (n: number, body: string): ILineSpec => ({
  type: DiffLineType.Add,
  old: null,
  new: n,
  body,
})

function toDiffLine(spec: ILineSpec): DiffLine {
  const marker =
    spec.type === DiffLineType.Add
      ? '+'
      : spec.type === DiffLineType.Delete
      ? '-'
      : ' '
  return new DiffLine(marker + spec.body, spec.type, null, spec.old, spec.new)
}

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

describe('a note whose line vanished becomes an orphan, not a lie', () => {
  it('drops out of the render map and into the orphaned list', () => {
    const before = textDiff([
      ctx(1, 'alpha'),
      add(2, 'the-uniquely-worded-line'),
      ctx(3, 'omega'),
    ])
    const anchor = createDiffAnchor(before, 'f.ts', 'new', 2)!
    const ann = annotation(1, anchor)

    // A later diff of the same file where that unique line no longer exists.
    const after = textDiff([ctx(1, 'alpha'), ctx(2, 'omega')])
    const layout = placeDiffAnnotations([ann], after, at('f.ts'))

    assert.strictEqual(layout.byDiffLine.size, 0, 'not remapped onto some line')
    assert.strictEqual(layout.orphaned.length, 1)
    assert.strictEqual(layout.orphaned[0].annotation.id, 1)
    assert.strictEqual(layout.orphaned[0].resolution.kind, 'orphaned')
    // The preview the anchor captured is still there for the orphan band.
    assert.strictEqual(
      layout.orphaned[0].annotation.anchor.contentPreview,
      'the-uniquely-worded-line'
    )
  })
})

describe('batch placement equals resolving each note on its own', () => {
  it('produces, for every note, the same resolution as an individual call', () => {
    const diff = textDiff([
      ctx(1, 'a'),
      ctx(2, 'b'),
      ctx(3, 'c'),
      ctx(4, 'd'),
      ctx(5, 'e'),
    ])
    const anns = [1, 3, 5].map(n =>
      annotation(n, createDiffAnchor(diff, 'f.ts', 'new', n)!)
    )
    // Add one note for a line that is not in this diff -> must orphan.
    const otherDiff = textDiff([ctx(99, 'gone')])
    anns.push(annotation(7, createDiffAnchor(otherDiff, 'f.ts', 'new', 99)!))

    const layout = placeDiffAnnotations(anns, diff, at('f.ts'))

    // Reconstruct the expected placement from individual resolutions.
    let placedCount = 0
    let orphanCount = 0
    for (const ann of anns) {
      const res = resolveDiffAnchor(ann.anchor, diff, at('f.ts'))
      if (res.kind === 'orphaned') {
        orphanCount++
        continue
      }
      const line = anchorResolutionToDiffLineNumber(res, diff, 'new')!
      const onLine = annotationsOnDiffLine(layout, line)
      assert.ok(
        onLine.some(r => r.annotation.id === ann.id),
        `note ${ann.id} placed on the same line as its individual resolution`
      )
      placedCount++
    }

    assert.strictEqual(placedCount, 3)
    assert.strictEqual(orphanCount, 1)
    assert.strictEqual(layout.orphaned.length, 1)
    assert.strictEqual(layout.orphaned[0].annotation.id, 7)
  })
})
