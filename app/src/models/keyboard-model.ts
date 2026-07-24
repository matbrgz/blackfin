// The keyboard-navigation decisions of the control center (#20), as pure
// functions written once so no surface invents its own.
//
// Two of #20's requirements are logic, not layout, and they are the two every
// implementation gets subtly wrong: what Escape closes (the "ladder"), and
// where focus lands after a row is deleted or the list reorders. Both are here,
// deterministic and tested, so the eventual UI wiring only has to *call* them.
//
// The destination-shortcut map is here too, because #20 requires it be checked
// against the existing menu accelerators before being promised — and it
// collides. That collision, and the resolution, is encoded as data rather than
// left to be rediscovered.
//
// Pure: no I/O, no DOM, no throwing, deterministic. Nothing here reads a key
// event; callers translate their event into these inputs.

// ─────────────────────────────────────────────────────────────
// The Escape ladder (#20 item 6). Escape closes the INNERMOST thing, in one
// fixed order, and — the two invariants that make it safe — never changes
// section and never closes the app.
// ─────────────────────────────────────────────────────────────

/**
 * What is currently open on a surface, innermost concerns first. Every field is
 * something a component already knows about itself; assembling this object is
 * the caller's whole job.
 */
export interface IEscapeState {
  /** A popover (filter dropdown, menu) is open. */
  readonly popoverOpen: boolean
  /** A typeahead search is mid-flight (the user is typing to jump to a row). */
  readonly typeaheadActive: boolean
  /** The filter box has text in it. */
  readonly filterText: string
  /** The detail pane is open. */
  readonly detailOpen: boolean
}

/**
 * The single action Escape performs next. `none` means Escape does nothing —
 * which is a real, deliberate outcome: it is what stops Escape from falling
 * through to "close the window", the default this ladder exists to prevent.
 */
export type EscapeAction =
  | { readonly kind: 'close-popover' }
  | { readonly kind: 'cancel-typeahead' }
  | { readonly kind: 'clear-filter' }
  | { readonly kind: 'close-detail' }
  | { readonly kind: 'none' }

/**
 * Decide what one Escape press does. The order of the checks IS the ladder, and
 * it runs innermost-first: a popover sits on top of everything, a typeahead is
 * more transient than a filter, and the detail pane is the outermost dismissible
 * thing. Below all of them is `none` — never a section change, never a close.
 *
 * Pure; never throws.
 */
export function nextEscapeAction(state: IEscapeState): EscapeAction {
  if (state.popoverOpen) {
    return { kind: 'close-popover' }
  }
  if (state.typeaheadActive) {
    return { kind: 'cancel-typeahead' }
  }
  if (state.filterText.trim().length > 0) {
    return { kind: 'clear-filter' }
  }
  if (state.detailOpen) {
    return { kind: 'close-detail' }
  }
  return { kind: 'none' }
}

// ─────────────────────────────────────────────────────────────
// Focus restoration (#20 item 7) — the part every implementation forgets.
// A keyboard user who loses focus to document.body has to start over from Tab.
// ─────────────────────────────────────────────────────────────

/**
 * The list index that should receive focus after the item at `removedIndex` is
 * deleted from a list that had `countBefore` items.
 *
 * The rule: move to the item that takes the deleted one's place (the next row),
 * except when the last row was deleted, in which case move to the new last row
 * (the previous one). Returns `null` only when the list is now empty — the one
 * case where there is no row to focus, and the caller must move focus somewhere
 * deliberate (the empty state's primary action) rather than let it fall to the
 * body.
 *
 * Pure; never throws. Out-of-range inputs collapse to the nearest sane answer
 * rather than throwing, because a focus calculation must never be the thing that
 * crashes a delete.
 */
export function focusIndexAfterRemoval(
  countBefore: number,
  removedIndex: number
): number | null {
  const countAfter = countBefore - 1
  if (countAfter <= 0) {
    return null
  }
  if (removedIndex <= 0) {
    return 0
  }
  // The next row now sits at `removedIndex`; clamp to the new last row when the
  // deleted item was at the end.
  return Math.min(removedIndex, countAfter - 1)
}

/**
 * Where focus goes after a rescan reorders the list. Focus follows the ITEM, not
 * the index — a rescan that sorts a four-gigabyte `node_modules` to the top must
 * not drag the user's focus to whatever now sits where they were.
 *
 * Returns the new index of the previously-focused id, or `null` if that item is
 * gone from the list (deleted out from under the user by the rescan), in which
 * case the caller falls back to `focusIndexAfterRemoval`-style logic against the
 * old index.
 *
 * Pure; never throws.
 */
export function focusIndexAfterReorder<T>(
  itemsAfter: ReadonlyArray<T>,
  idOf: (item: T) => string,
  focusedId: string | null
): number | null {
  if (focusedId === null) {
    return null
  }
  const index = itemsAfter.findIndex(item => idOf(item) === focusedId)
  return index === -1 ? null : index
}

// ─────────────────────────────────────────────────────────────
// Roving-tabindex arithmetic (#20 items 1, 4) — the vertical-arrow movement
// inside a single Tab stop (the rail, a list). Extracted because off-by-one and
// wrap-around are exactly what a test should pin.
// ─────────────────────────────────────────────────────────────

/** Direction of an arrow-key move within a roving-tabindex group. */
export type RovingMove = 'up' | 'down' | 'first' | 'last'

/**
 * The index a roving-tabindex group moves to. Movement is CLAMPED, not
 * wrapping: Down on the last item stays on the last item. Wrapping a vertical
 * rail surprises users and, worse, makes "am I at the end" unknowable without
 * looking. `count === 0` returns `null` — nothing to focus.
 *
 * Pure; never throws.
 */
export function rovingIndex(
  count: number,
  current: number,
  move: RovingMove
): number | null {
  if (count <= 0) {
    return null
  }
  const last = count - 1
  const clamped = Math.max(0, Math.min(current, last))
  switch (move) {
    case 'up':
      return Math.max(0, clamped - 1)
    case 'down':
      return Math.min(last, clamped + 1)
    case 'first':
      return 0
    case 'last':
      return last
    default: {
      const unhandled: never = move
      return unhandled
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Destination shortcuts (#20 item 2). The issue requires these be checked
// against the existing menu accelerators BEFORE being promised — and the naive
// scheme collides. This encodes the finding and the resolution.
// ─────────────────────────────────────────────────────────────

/**
 * The accelerators the shipped menu already binds on the digit row
 * (`build-default-menu.ts`). The naive proposal in #20 — `CmdOrCtrl+1..5` for
 * the five destinations — would silently override the first three, which the
 * issue explicitly forbids. Recorded so the collision is a fact in code, not a
 * surprise at review.
 */
export const ReservedDigitAccelerators: ReadonlyMap<string, string> = new Map([
  ['CmdOrCtrl+1', 'View → Show Changes'],
  ['CmdOrCtrl+2', 'View → Show History'],
  ['CmdOrCtrl+3', 'View → Show Compare'],
  ['CmdOrCtrl+0', 'View → Reset Zoom'],
  ['CmdOrCtrl+8', 'View → (accessibility)'],
  ['CmdOrCtrl+9', 'View → (accessibility)'],
])

/** A rail destination, in rail order. Mirrors `AppSection` without importing UI. */
export type DestinationKey = 'home' | 'code' | 'agents' | 'docs' | 'disk'

/**
 * The chosen destination shortcuts: `CmdOrCtrl+Alt+1..5`, in rail order.
 *
 * `CmdOrCtrl+Alt+<digit>` is used rather than `CmdOrCtrl+<digit>` precisely
 * because the plain digits are taken (see `ReservedDigitAccelerators`). The
 * `Alt` layer is free across the whole shipped menu, so these can be promised
 * without overriding anything — which is the bar #20 set.
 */
export const DestinationShortcuts: ReadonlyArray<{
  readonly destination: DestinationKey
  readonly accelerator: string
}> = [
  { destination: 'home', accelerator: 'CmdOrCtrl+Alt+1' },
  { destination: 'code', accelerator: 'CmdOrCtrl+Alt+2' },
  { destination: 'agents', accelerator: 'CmdOrCtrl+Alt+3' },
  { destination: 'docs', accelerator: 'CmdOrCtrl+Alt+4' },
  { destination: 'disk', accelerator: 'CmdOrCtrl+Alt+5' },
]

/**
 * Whether a proposed accelerator collides with one the shipped menu already
 * binds. The guard behind the promise: a test calls this over
 * `DestinationShortcuts` and fails if any of them is ever reserved, so the
 * scheme cannot regress into a silent override.
 *
 * Pure; never throws.
 */
export function collidesWithReserved(accelerator: string): boolean {
  return ReservedDigitAccelerators.has(accelerator)
}
