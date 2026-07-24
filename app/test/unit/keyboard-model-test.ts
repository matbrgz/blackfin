import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DestinationShortcuts,
  IEscapeState,
  ReservedDigitAccelerators,
  collidesWithReserved,
  focusIndexAfterRemoval,
  focusIndexAfterReorder,
  nextEscapeAction,
  rovingIndex,
} from '../../src/models/keyboard-model'

function escapeState(overrides: Partial<IEscapeState> = {}): IEscapeState {
  return {
    popoverOpen: false,
    typeaheadActive: false,
    filterText: '',
    detailOpen: false,
    ...overrides,
  }
}

describe('nextEscapeAction — the ladder, innermost first', () => {
  it('closes a popover before anything else', () => {
    const action = nextEscapeAction(
      escapeState({
        popoverOpen: true,
        typeaheadActive: true,
        filterText: 'x',
        detailOpen: true,
      })
    )
    assert.deepStrictEqual(action, { kind: 'close-popover' })
  })

  it('cancels typeahead before clearing a filter', () => {
    const action = nextEscapeAction(
      escapeState({ typeaheadActive: true, filterText: 'x', detailOpen: true })
    )
    assert.deepStrictEqual(action, { kind: 'cancel-typeahead' })
  })

  it('clears a filter before closing the detail pane', () => {
    const action = nextEscapeAction(
      escapeState({ filterText: 'src', detailOpen: true })
    )
    assert.deepStrictEqual(action, { kind: 'clear-filter' })
  })

  it('treats a whitespace-only filter as no filter', () => {
    const action = nextEscapeAction(
      escapeState({ filterText: '   ', detailOpen: true })
    )
    assert.deepStrictEqual(action, { kind: 'close-detail' })
  })

  it('closes the detail pane when nothing inner is open', () => {
    const action = nextEscapeAction(escapeState({ detailOpen: true }))
    assert.deepStrictEqual(action, { kind: 'close-detail' })
  })

  it('does nothing — never a section change, never a close — when all is quiet', () => {
    assert.deepStrictEqual(nextEscapeAction(escapeState()), { kind: 'none' })
  })
})

describe('focusIndexAfterRemoval', () => {
  it('moves to the next row, which now sits at the deleted index', () => {
    // [a b c d], delete b (index 1) → [a c d], focus c, now at index 1.
    assert.equal(focusIndexAfterRemoval(4, 1), 1)
  })

  it('moves to the new last row when the last was deleted', () => {
    // [a b c d], delete d (index 3) → [a b c], focus c at index 2.
    assert.equal(focusIndexAfterRemoval(4, 3), 2)
  })

  it('stays at the top when the first row was deleted', () => {
    assert.equal(focusIndexAfterRemoval(4, 0), 0)
  })

  it('returns null when the list becomes empty', () => {
    // The one case with no row to focus — the caller must place focus itself.
    assert.equal(focusIndexAfterRemoval(1, 0), null)
  })

  it('never throws on an out-of-range index, it clamps', () => {
    assert.equal(focusIndexAfterRemoval(3, 99), 1)
    assert.equal(focusIndexAfterRemoval(3, -5), 0)
  })
})

describe('focusIndexAfterReorder — focus follows the item, not the index', () => {
  const idOf = (item: { id: string }) => item.id

  it('finds the previously-focused item at its new position', () => {
    // A rescan sorted the big node_modules to the top; focus must not drift.
    const after = [{ id: 'big' }, { id: 'api' }, { id: 'web' }]
    assert.equal(focusIndexAfterReorder(after, idOf, 'web'), 2)
  })

  it('returns null when the focused item is gone after the rescan', () => {
    const after = [{ id: 'api' }, { id: 'web' }]
    assert.equal(focusIndexAfterReorder(after, idOf, 'deleted'), null)
  })

  it('returns null when nothing was focused', () => {
    const after = [{ id: 'api' }]
    assert.equal(focusIndexAfterReorder(after, idOf, null), null)
  })
})

describe('rovingIndex — clamped, not wrapping', () => {
  it('moves down and up within range', () => {
    assert.equal(rovingIndex(5, 2, 'down'), 3)
    assert.equal(rovingIndex(5, 2, 'up'), 1)
  })

  it('stays put at the ends rather than wrapping', () => {
    assert.equal(rovingIndex(5, 4, 'down'), 4)
    assert.equal(rovingIndex(5, 0, 'up'), 0)
  })

  it('jumps to first and last', () => {
    assert.equal(rovingIndex(5, 3, 'first'), 0)
    assert.equal(rovingIndex(5, 1, 'last'), 4)
  })

  it('clamps a bogus current index before moving', () => {
    // 99 clamps to the last index (4), then up moves to 3.
    assert.equal(rovingIndex(5, 99, 'up'), 3)
    // -3 clamps to 0, then down moves to 1.
    assert.equal(rovingIndex(5, -3, 'down'), 1)
  })

  it('returns null for an empty group', () => {
    assert.equal(rovingIndex(0, 0, 'down'), null)
  })
})

describe('destination shortcuts do not collide with the shipped menu', () => {
  it('the plain digit accelerators are genuinely taken', () => {
    // The reason the Alt layer is needed at all — recorded, not assumed.
    assert.equal(collidesWithReserved('CmdOrCtrl+1'), true)
    assert.equal(collidesWithReserved('CmdOrCtrl+2'), true)
    assert.equal(collidesWithReserved('CmdOrCtrl+3'), true)
  })

  it('every destination shortcut is free of the reserved set', () => {
    for (const { accelerator } of DestinationShortcuts) {
      assert.equal(
        collidesWithReserved(accelerator),
        false,
        `${accelerator} collides with ${ReservedDigitAccelerators.get(
          accelerator
        )}`
      )
    }
  })

  it('there are five, one per rail destination, in order', () => {
    assert.deepStrictEqual(
      DestinationShortcuts.map(s => s.destination),
      ['home', 'code', 'agents', 'docs', 'disk']
    )
  })
})
