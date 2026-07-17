import { LineAttribution } from '../../models/diff-attribution'

// The pure core of the attribution filter (#71).
//
// #70 records what an agent declared it authored and paints the gutter. This
// module is what turns that datum into leverage: given the per-line attribution
// of the diff currently on screen, it decides which contiguous, *un*attributed
// regions should collapse — so "review this 800-line diff" becomes "review the
// 600 the agent wrote", with the other 200 folded behind a clickable summary,
// never hidden.
//
// It is pure: no fs, no Dexie, no React, no clock, no git. It reads only its
// arguments and returns plain data. And it NEVER throws — a malformed row set,
// an out-of-range index, an empty attribution map are all ordinary *results*,
// because a review tool that crashes on odd input is a review tool that stops
// being trusted.
//
// The one rule that makes the feature honest lives here, not only in the UI:
// when nothing in the diff is attributed to an agent, this function collapses
// NOTHING. A filter that folded an entire diff for lack of data would, in
// effect, assert "the agent wrote none of this" — a claim Blackfin cannot make.
// So `hasAnyData: false` (which yields a map with zero `'agent'` lines) and a
// diff the agent simply never touched both come out the same, safe way: zero
// regions. The lock is the first line of code, not an afterthought in a popover.
//
// Like the rest of the model, it cannot express human authorship. It preserves
// what an agent *claimed*; everything else is "unattributed", never "yours".

/**
 * The default number of rows of context kept on each side of an agent-attributed
 * block. One claimed line with no code around it is not reviewable.
 */
export const DefaultAttributionContextLines = 3

/**
 * The smallest contiguous run of collapsible rows worth folding. Below this,
 * swapping (say) two rows of code for a one-row "2 lines collapsed" summary costs
 * more attention than it saves, so short runs stay visible.
 */
export const MinCollapseSize = 4

/**
 * Which side of the single attribution axis the filter keeps in view.
 *
 * There is deliberately no `'human'` mode: `'unattributed'` keeps the lines no
 * agent claimed (which may be the user, or an agent that never ran the CLI), and
 * is labelled as such — never "yours". `'agent'` is the primary feature of #71;
 * `'unattributed'` is its honest inverse.
 */
export type AttributionFilterMode = 'agent' | 'unattributed'

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
   * The diff line number for THIS render, used to look up attribution in the map.
   * Ephemeral — it dies with the diff — and `null` for rows without one (hunk
   * headers, and any row that carries no stable diff line). A `null` line is
   * never `'agent'`.
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
  /** Which lines to keep in view. Defaults to `'agent'` — the feature of #71. */
  readonly mode?: AttributionFilterMode
  /** Rows of context kept each side of a preserved block. Default 3. */
  readonly contextLines?: number
  /** Runs shorter than this are not folded. Default 4. */
  readonly minCollapseSize?: number
}

/** The honest header counter: attributed vs. not, over foldable line rows. */
export interface IAttributionCounts {
  /** Rows attributed to an agent. */
  readonly agentLineCount: number
  /** Rows not attributed to any agent (the collapsible pool, ignoring context). */
  readonly unattributedLineCount: number
  /** All line rows considered — hunk headers excluded, they are structure. */
  readonly totalLineCount: number
}

/**
 * Is this row the one the current mode keeps *in view on its own merit*? For
 * `'agent'`, an agent-claimed line; for `'unattributed'`, a line no agent
 * claimed. Hunk headers and `null`-line rows are never a target: they are
 * preserved for structure, but they do not seed a context window.
 */
function isTargetRow(
  row: IAttributableRow,
  attribution: ReadonlyMap<number, LineAttribution>,
  mode: AttributionFilterMode
): boolean {
  if (row.isHunkHeader || row.diffLineNumber === null) {
    return false
  }
  const line = attribution.get(row.diffLineNumber)
  const isAgent = line !== undefined && line.state === 'agent'
  return mode === 'agent' ? isAgent : !isAgent
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
 * The veracity lock: if NO row is a target (the map has no `'agent'` line — which
 * is exactly the `hasAnyData: false` case — or, in `'unattributed'` mode, every
 * line is the agent's), the function returns zero regions. It never folds a diff
 * it has no basis to fold.
 *
 * Pure and total: `annotatedRows` holds row indices of THIS render; anything out
 * of range is simply ignored. Never throws.
 */
export function computeCollapsedRegions(
  rows: ReadonlyArray<IAttributableRow>,
  attribution: ReadonlyMap<number, LineAttribution>,
  annotatedRows: ReadonlySet<number>,
  options: IAttributionFilterOptions
): ReadonlyArray<ICollapsedRegion> {
  const mode: AttributionFilterMode = options.mode ?? 'agent'
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
    if (isTargetRow(rows[i], attribution, mode)) {
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
 * The honest counter for the header: how many line rows are the agent's, how many
 * are not, out of the total. Hunk headers are structure, not lines, and are
 * excluded from every count. This never depends on the filter being on — it
 * reports the truth of the diff so the user can see when the numbers look wrong.
 */
export function summarizeAttributionCounts(
  rows: ReadonlyArray<IAttributableRow>,
  attribution: ReadonlyMap<number, LineAttribution>
): IAttributionCounts {
  let agentLineCount = 0
  let totalLineCount = 0
  for (const row of rows) {
    if (row.isHunkHeader) {
      continue
    }
    totalLineCount++
    if (row.diffLineNumber !== null) {
      const line = attribution.get(row.diffLineNumber)
      if (line !== undefined && line.state === 'agent') {
        agentLineCount++
      }
    }
  }
  return {
    agentLineCount,
    unattributedLineCount: totalLineCount - agentLineCount,
    totalLineCount,
  }
}
