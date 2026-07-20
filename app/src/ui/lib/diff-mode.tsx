import { getBoolean, setBoolean } from '../../lib/local-storage'

export const ShowSideBySideDiffDefault = false
const showSideBySideDiffKey = 'show-side-by-side-diff'
export const ShowDiffMinimapDefault = false
const showDiffMinimapKey = 'show-diff-minimap'
export const ShowWholeFileDefault = false
const showWholeFileKey = 'show-whole-file'
export const WrapDiffLinesDefault = true
const wrapDiffLinesKey = 'wrap-diff-lines'

/**
 * Gets a value indicating whether not to present diffs in a split view mode
 * as opposed to unified (the default).
 */
export function getShowSideBySideDiff(): boolean {
  return getBoolean(showSideBySideDiffKey, ShowSideBySideDiffDefault)
}

/**
 * Sets a local storage key indicating whether not to present diffs in a split
 * view mode as opposed to unified (the default).
 */
export function setShowSideBySideDiff(showSideBySideDiff: boolean) {
  setBoolean(showSideBySideDiffKey, showSideBySideDiff)
}

/**
 * Gets a value indicating whether to present the diff minimap.
 */
export function getShowDiffMinimap(): boolean {
  return getBoolean(showDiffMinimapKey, ShowDiffMinimapDefault)
}

/**
 * Sets a local storage key indicating whether to present the diff minimap.
 */
export function setShowDiffMinimap(showDiffMinimap: boolean) {
  setBoolean(showDiffMinimapKey, showDiffMinimap)
}

/**
 * Gets a value indicating whether to keep text diffs expanded to the whole file.
 */
export function getShowWholeFile(): boolean {
  return getBoolean(showWholeFileKey, ShowWholeFileDefault)
}

/**
 * Sets a local storage key indicating whether to keep text diffs expanded to
 * the whole file.
 */
export function setShowWholeFile(showWholeFile: boolean) {
  setBoolean(showWholeFileKey, showWholeFile)
}

/**
 * Gets a value indicating whether text diff lines should wrap.
 */
export function getWrapDiffLines(): boolean {
  return getBoolean(wrapDiffLinesKey, WrapDiffLinesDefault)
}

/** Persists the text diff line wrapping preference. */
export function setWrapDiffLines(wrapDiffLines: boolean) {
  setBoolean(wrapDiffLinesKey, wrapDiffLines)
}

/**
 * Whether the file should preserve word boundaries when diff lines wrap.
 */
export function isMarkdownFile(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mkdn|mdx)$/i.test(path)
}

/**
 * Converts wheel input into the shared horizontal diff scroll delta.
 */
export function getDiffHorizontalScrollDelta(
  deltaX: number,
  deltaY: number,
  shiftKey: boolean
): number {
  return shiftKey ? deltaY || deltaX : deltaX
}

/**
 * Counts the monospace columns occupied by a diff line. Tabs advance to the
 * same four-column stops used by syntax highlighting.
 */
export function getDiffLineColumnCount(line: string, tabSize = 4): number {
  let columns = 0

  for (const character of line) {
    columns += character === '\t' ? tabSize - (columns % tabSize) : 1
  }

  return columns
}

/**
 * Builds the width of the shared horizontal scrollbar contents.
 *
 * The scrollable range must include the visible diff prefix and line-number
 * gutter in addition to the longest source line. Split view also starts each
 * content viewport halfway across the diff.
 */
export function getDiffUnwrappedWidth(
  maxLineColumns: number,
  lineNumberWidth: string,
  showSideBySideDiff: boolean,
  showDiffCheckMarks: boolean
): string {
  const parts = new Array<string>()

  if (showSideBySideDiff) {
    parts.push('50%')
  }

  // renderContent() places two spaces, the +/- marker, and two more spaces
  // before the source text.
  parts.push(`${maxLineColumns + 5}ch`, lineNumberWidth)

  if (!showSideBySideDiff) {
    parts.push(lineNumberWidth)
  }

  if (showDiffCheckMarks) {
    parts.push('20px')
  }

  return `max(100%, calc(${parts.join(' + ')}))`
}
