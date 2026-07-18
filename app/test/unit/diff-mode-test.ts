import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'

import {
  DiffLineWrappingChangedEvent,
  getDiffHorizontalScrollDelta,
  getWrapDiffLines,
  isMarkdownFile,
  setWrapDiffLines,
  WrapDiffLinesDefault,
} from '../../src/ui/lib/diff-mode'

describe('diff presentation mode', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('wraps diff lines by default and persists changes', () => {
    assert.strictEqual(getWrapDiffLines(), WrapDiffLinesDefault)

    setWrapDiffLines(false)

    assert.strictEqual(getWrapDiffLines(), false)
  })

  it('notifies active diff surfaces when line wrapping changes', () => {
    let wrapDiffLines: boolean | undefined
    const listener = (event: Event) => {
      wrapDiffLines = (event as CustomEvent<boolean>).detail
    }

    document.addEventListener(DiffLineWrappingChangedEvent, listener)
    setWrapDiffLines(false)
    document.removeEventListener(DiffLineWrappingChangedEvent, listener)

    assert.strictEqual(wrapDiffLines, false)
  })

  it('recognizes Markdown file extensions case-insensitively', () => {
    for (const path of [
      'README.md',
      'docs/guide.markdown',
      'notes/example.mdown',
      'notes/example.mkd',
      'notes/example.mkdn',
      'docs/component.MDX',
    ]) {
      assert.strictEqual(isMarkdownFile(path), true, path)
    }

    for (const path of [
      'src/example.ts',
      'docs/markdown-guide.txt',
      'Makefile',
    ]) {
      assert.strictEqual(isMarkdownFile(path), false, path)
    }
  })

  it('maps shifted and native horizontal wheel input to one delta', () => {
    assert.strictEqual(getDiffHorizontalScrollDelta(0, 40, true), 40)
    assert.strictEqual(getDiffHorizontalScrollDelta(25, 0, true), 25)
    assert.strictEqual(getDiffHorizontalScrollDelta(25, 40, false), 25)
    assert.strictEqual(getDiffHorizontalScrollDelta(0, 40, false), 0)
  })
})
