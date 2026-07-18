import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import * as React from 'react'

import { DiffOptions } from '../../../src/ui/diff/diff-options'
import { getWrapDiffLines } from '../../../src/ui/lib/diff-mode'
import { fireEvent, render, screen } from '../../helpers/ui/render'

function renderDiffOptions() {
  return render(
    <DiffOptions
      isInteractiveDiff={false}
      hideWhitespaceChanges={false}
      onHideWhitespaceChangesChanged={() => {}}
      showSideBySideDiff={false}
      onShowSideBySideDiffChanged={() => {}}
      showDiffMinimap={false}
      onShowDiffMinimapChanged={() => {}}
      onDiffOptionsOpened={() => {}}
    />
  )
}

describe('DiffOptions', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('persists the line wrapping preference', () => {
    renderDiffOptions()
    fireEvent.click(
      screen.getByRole('button', { name: /^Diff (Options|Settings)$/ })
    )

    const wrapLines = screen.getByLabelText(/wrap lines/i)
    assert.strictEqual((wrapLines as HTMLInputElement).checked, true)

    fireEvent.click(wrapLines)

    assert.strictEqual(getWrapDiffLines(), false)
    assert.strictEqual((wrapLines as HTMLInputElement).checked, false)
  })
})
