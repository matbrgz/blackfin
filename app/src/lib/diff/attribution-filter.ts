import { LineAuthorship } from './commit-ai-signature'

// The pure core of the attribution filter (#71).
//
// #70 derives, from the commit's AI authorship signature (its `Co-Authored-By`
// trailer, mapped to lines by `git blame`), a per-line verdict:
// `ai | non-ai | uncommitted`. This module is what turns that verdict into
// leverage: given the per-line authorship of the diff currently on screen, it
// decides which contiguous, *non-AI* regions should collapse — so "review this
// 800-line diff" becomes "review the 600 the AI wrote", with the rest folded
// behind a clickable summary, never hidden.
//
// It is pure: no fs, no Dexie, no React, no clock, no git. It reads only its
// arguments and returns plain data. And it NEVER throws — a malformed row set,
// an out-of-range index, an empty authorship map are all ordinary *results*,
// because a review tool that crashes on odd input is a review tool that stops
// being trusted.
//
// The one rule that makes the feature honest lives here, not only in the UI:
// when nothing in the diff is attributed to AI, this function collapses
// NOTHING. A filter that folded an entire diff for lack of an AI line would, in
// effect, assert "the AI wrote none of this" — a claim Blackfin cannot make
// when the real reason may be that the lines were never committed and so carry
// no signature to read. So a diff with no `'ai'` line (every line `'non-ai'` or
// `'uncommitted'`) comes out the one safe way: zero regions, filter disabled.
// The lock is the first branch of code, not an afterthought in a popover.
//
// The verdict source is the commit signature, never a guess about a human
// typing. A `'non-ai'` line means the commit carried no AI marker; a
// `'uncommitted'` line has no commit to attribute yet. Neither is ever labelled
// "yours" — the honest labels are "sem IA" and "não commitado".

/**
 * The default number of rows of context kept on each side of an AI-attributed
 * block. One AI line with no code around it is not reviewable.
 */
export const DefaultAttributionContextLines = 3

/**
 * The smallest contiguous run of collapsible rows worth folding. Below this,
 * swapping (say) two rows of code for a one-row "2 lines collapsed" summary costs
 * more attention than it saves, so short runs stay visible.
 */
export const MinCollapseSize = 4

/**
 * Which lines the filter keeps in view. The axis is a single one: "show AI" vs.
 * "show all". `'ai'` is the primary feature of #71 — keep what the AI wrote,
 * fold everything else (both `'non-ai'` and `'uncommitted'`). `'all'` is the
 * filter-off view: keep everything, fold nothing.
 *
 * There is deliberately no `'human'` mode. Blackfin does not know a human wrote
 * the non-AI lines; it knows only that their commits carry no AI signature. The
 * inverse of "show AI" is "show all", not "show yours".
 */
export type AttributionFilterMode = 'ai' | 'all'

/**
 * The minimal, render-agnostic description of one diff row the filter needs.
 * Deliberately NOT the UI's `DiffRow`: the core stays free of React and of the
 * heavy row union, and depends only on the two facts that drive the decision.
 */
export interface IAttributableRow {
  /**
   * A hunk-header row. The diff's structure never collapses, so these are always
   * preserved and they split any collapsible run they fall in.
   */
  readonly isHunkHeader: boolean

  /**
   * The diff line number for THIS render, used to look up authorship in the map.
   * Ephemeral — it dies with the diff — and `null` for rows without one (hunk
   * headers, and any row that carries no stable diff line). A `null` line is
   * never `'ai'`.
   */
  readonly diffLineNumber: number | null
}

/** A contiguous run of rows the filter folds. Indices address THIS render only. */
export interface ICollapsedRegion {
  /** First folded row, inclusive. An index into the row array of this render. */
  readonly startRowIndex: number
  /** Last folded row, inclusive. `endRowIndex >= startRowIndex` always holds. */
  readonly endRowIndex: number
  /** How many rows the region folds. Equals `endRowIndex - startRowIndex + 1`. */
  readonly lineCount: number
}

/** Options for {@link computeCollapsedRegions}. All optional but the mode. */
export interface IAttributionFilterOptions {
  /** Which lines to keep in view. Defaults to `'ai'` — the feature of #71. */
  readonly mode?: AttributionFilterMode
  /** Rows of context kept each side of a preserved block. Default 3. */
  readonly contextLines?: number
  /** Runs shorter than this are not folded. Default 4. */
  readonly minCollapseSize?: number
}

/** The honest header counter: AI vs. not, over foldable line rows. */
export interface IAttributionCounts {
  /** Rows the AI wrote (their commit carries an AI signature). */
  readonly aiLineCount: number
  /**
   * Rows not attributed to AI — the collapsible pool, ignoring context. This is
   * `non-ai` + `uncommitted`: everything whose commit has no AI signature, plus
   * everything with no commit yet. Labelled "sem IA / não commitado", never
   * "yours".
   */
  readonly nonAiLineCount: number
  /** All line rows considered — hunk headers excluded, they are structure. */
  readonly totalLineCount: number
}

/**
 * Is this row the one the current mode keeps *in view on its own merit*? For
 * `'ai'`, an AI-authored line; for `'all'`, every line is a target (nothing is
 * ever folded). Hunk headers and `null`-line rows are never a target: they are
 * preserved for structure, but they do not seed a context window.
 */
function isTargetRow(
  row: IAttributableRow,
  authorships: ReadonlyMap<number, LineAuthorship>,
  mode: AttributionFilterMode
): boolean {
  if (mode === 'all') {
    // Show-all keeps every line; the lock below never trips and nothing folds.
    return true
  }
  if (row.isHunkHeader || row.diffLineNumber === null) {
    return false
  }
  return authorships.get(row.diffLineNumber) === 'ai'
}

/**
 * Decide which contiguous regions of the diff collapse, in row-index space.
 *
 * Rules, in order:
 *   1. A target row (see {@link isTargetRow}) is preserved.
 *   2. A row within `contextLines` of a target row is preserved.
 *   3. An annotated row is preserved — always, no exception. Hiding a comment the
 *      user wrote is deleting it from their view.
 *   4. A hunk-header row is preserved — the diff's structure never collapses.
 *   5. Everything else is collapsible. Maximal contiguous runs become regions; a
 *      run shorter than `minCollapseSize` stays visible.
 *
 * The veracity lock: if NO row is a target (in `'ai'` mode, the map has no
 * `'ai'` line — every line is `'non-ai'` or `'uncommitted'`), the function
 * returns zero regions. It never folds a diff it has no basis to fold, because
 * folding it would falsely suggest the AI wrote none of it.
 *
 * Pure and total: `annotatedRows` holds row indices of THIS render; anything out
 * of range is simply ignored. Never throws.
 */
export function computeCollapsedRegions(
  rows: ReadonlyArray<IAttributableRow>,
  authorships: ReadonlyMap<number, LineAuthorship>,
  annotatedRows: ReadonlySet<number>,
  options: IAttributionFilterOptions
): ReadonlyArray<ICollapsedRegion> {
  const mode: AttributionFilterMode = options.mode ?? 'ai'
  const contextLines = Math.max(
    0,
    options.contextLines ?? DefaultAttributionContextLines
  )
  const minCollapseSize = Math.max(
    1,
    options.minCollapseSize ?? MinCollapseSize
  )

  const rowCount = rows.length
  if (rowCount === 0) {
    return []
  }

  // Rule 1: locate the target rows. If there are none, the lock trips and we
  // fold nothing — this is the single most important branch in the module.
  const targetIndices: Array<number> = []
  for (let i = 0; i < rowCount; i++) {
    if (isTargetRow(rows[i], authorships, mode)) {
      targetIndices.push(i)
    }
  }
  if (targetIndices.length === 0) {
    return []
  }

  const preserved = new Array<boolean>(rowCount).fill(false)

  // Rules 1 + 2: preserve each target row and its context window.
  for (const index of targetIndices) {
    const from = Math.max(0, index - contextLines)
    const to = Math.min(rowCount - 1, index + contextLines)
    for (let i = from; i <= to; i++) {
      preserved[i] = true
    }
  }

  // Rules 3 + 4: preserve annotated rows and hunk headers, always.
  for (let i = 0; i < rowCount; i++) {
    if (rows[i].isHunkHeader || annotatedRows.has(i)) {
      preserved[i] = true
    }
  }

  // Rule 5: every maximal run of non-preserved rows is a candidate region; keep
  // only those at least `minCollapseSize` long.
  const regions: Array<ICollapsedRegion> = []
  let runStart = -1
  for (let i = 0; i < rowCount; i++) {
    if (!preserved[i]) {
      if (runStart === -1) {
        runStart = i
      }
      continue
    }
    if (runStart !== -1) {
      pushRegionIfLongEnough(regions, runStart, i - 1, minCollapseSize)
      runStart = -1
    }
  }
  if (runStart !== -1) {
    pushRegionIfLongEnough(regions, runStart, rowCount - 1, minCollapseSize)
  }

  return regions
}

function pushRegionIfLongEnough(
  regions: Array<ICollapsedRegion>,
  startRowIndex: number,
  endRowIndex: number,
  minCollapseSize: number
): void {
  const lineCount = endRowIndex - startRowIndex + 1
  if (lineCount >= minCollapseSize) {
    regions.push({ startRowIndex, endRowIndex, lineCount })
  }
}

/**
 * Expand one collapsed region by its start index, leaving the others untouched.
 * A start index that matches no region returns the set unchanged — expanding a
 * region that is already open is not an error. Never throws.
 */
export function expandRegion(
  regions: ReadonlyArray<ICollapsedRegion>,
  startRowIndex: number
): ReadonlyArray<ICollapsedRegion> {
  return regions.filter(region => region.startRowIndex !== startRowIndex)
}

/** Expand every region. Always the empty set — the whole diff comes back. */
export function expandAll(): ReadonlyArray<ICollapsedRegion> {
  return []
}

/** Is the row at `rowIndex` inside any collapsed region? */
export function isRowCollapsed(
  regions: ReadonlyArray<ICollapsedRegion>,
  rowIndex: number
): boolean {
  return regions.some(
    region => rowIndex >= region.startRowIndex && rowIndex <= region.endRowIndex
  )
}

/**
 * The row indices left visible after folding — every row not inside a collapsed
 * region, in ascending order. This is the render's row set; it never drops a hunk
 * header or an annotated row, because those are never in a region to begin with.
 */
export function visibleRowIndices(
  rowCount: number,
  regions: ReadonlyArray<ICollapsedRegion>
): ReadonlyArray<number> {
  const visible: Array<number> = []
  for (let i = 0; i < rowCount; i++) {
    if (!isRowCollapsed(regions, i)) {
      visible.push(i)
    }
  }
  return visible
}

/**
 * The honest counter for the header: how many line rows the AI wrote, how many
 * it did not, out of the total. Hunk headers are structure, not lines, and are
 * excluded from every count. This never depends on the filter being on — it
 * reports the truth of the diff so the user can see when the numbers look wrong.
 *
 * `nonAiLineCount` pools `non-ai` and `uncommitted`: from the header's point of
 * view both are "not the AI's", and both are what the `'ai'` filter folds. It is
 * labelled "sem IA / não commitado", never "yours".
 */
export function summarizeAttributionCounts(
  rows: ReadonlyArray<IAttributableRow>,
  authorships: ReadonlyMap<number, LineAuthorship>
): IAttributionCounts {
  let aiLineCount = 0
  let totalLineCount = 0
  for (const row of rows) {
    if (row.isHunkHeader) {
      continue
    }
    totalLineCount++
    if (row.diffLineNumber !== null) {
      if (authorships.get(row.diffLineNumber) === 'ai') {
        aiLineCount++
      }
    }
  }
  return {
    aiLineCount,
    nonAiLineCount: totalLineCount - aiLineCount,
    totalLineCount,
  }
}

// DEFERRED (runtime/UI, verified by the maintainer; not this PR):
//   1. The `DiffOptions` control — a third toggle beside `hideWhitespaceChanges`
//      / `showSideBySideDiff`: "Mostrar só o que a IA escreveu".
//   2. The app-store preference on the `hideWhitespaceInChangesDiff` path
//      (key, default `false`, `getBoolean`/`setBoolean`, `IAppState` field).
//   3. The virtualized-list height-cache invalidation on toggle
//      (`clearListRowsHeightCache` + `recomputeRowHeights`) — the diff's row
//      count changes, so the react-virtualized `CellMeasurer` cache must clear.
// This module is the deterministic collapse core only.
