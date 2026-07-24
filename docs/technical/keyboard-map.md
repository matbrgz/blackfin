# Keyboard map

- **Issue:** [#20](https://github.com/matbrgz/blackfin/issues/20) — *Keyboard navigation and focus model across the control center*
- **Source of truth:** the shortcut scheme, the Escape ladder and the focus rules are defined in `app/src/models/keyboard-model.ts` and covered by `app/test/unit/keyboard-model-test.ts`. This page is the human-readable rendering #20 requires — *a shortcut nobody can discover is a shortcut that does not exist.*

The UI wiring that binds these (roving tabindex on the rail, the tree contract,
the `TabBar` scope selector, `aria-live` regions) is deferred until #18 ships the
components it hangs on. What is settled here is the *logic*: what each key does,
independent of which component reads the event.

## Zones and movement

Three focus zones, one Tab stop each:

```text
[rail] → [section content] → [detail pane, if open]
```

- **Tab / Shift+Tab** — move between zones.
- **F6 / Shift+F6** — cycle zones (the desktop convention; the answer to "I am
  stuck in the list").
- Inside the **rail**: **↑ / ↓** move between destinations (roving tabindex —
  the rail is one Tab stop, not five). Movement is **clamped, not wrapping**
  (`rovingIndex`): Down on the last destination stays there.
- Inside a **list / tree**: rows are managed with `aria-activedescendant`; they
  are not individual Tab stops.

## Destination shortcuts

**`CmdOrCtrl+Alt+1..5`**, in rail order:

| Shortcut | Destination |
|---|---|
| `CmdOrCtrl+Alt+1` | Home |
| `CmdOrCtrl+Alt+2` | Code |
| `CmdOrCtrl+Alt+3` | Agents |
| `CmdOrCtrl+Alt+4` | Docs |
| `CmdOrCtrl+Alt+5` | Disk |

**Why the `Alt` layer and not the plain digits.** #20 required that the scheme be
checked against the existing menu accelerators before being promised. It was, and
the plain digits are taken (`build-default-menu.ts`):

| Reserved | Bound to |
|---|---|
| `CmdOrCtrl+1` | View → Show Changes |
| `CmdOrCtrl+2` | View → Show History |
| `CmdOrCtrl+3` | View → Show Compare |
| `CmdOrCtrl+0` / `+8` / `+9` | View → zoom / accessibility |

`CmdOrCtrl+Alt+<digit>` is free across the whole shipped menu, so the destination
shortcuts can be promised without overriding anything. `collidesWithReserved` is
the guard: a test runs it over every destination shortcut and fails if one ever
becomes reserved, so the scheme cannot regress into a silent override.

## The tree

Once the `Tree` component (from #18) lands, it binds through the `onRowKeyDown`
that `List` already exposes:

- **→** — expand; if already expanded, go to the first child.
- **←** — collapse; if already collapsed, go to the parent.
- **Home / End** — first / last visible row.
- **Typeahead** — type to jump to the row whose name matches.
- **Enter** — open in the detail pane. **Enter never destroys.**

## The Escape ladder

Escape closes the **innermost** thing, in this fixed order (`nextEscapeAction`):

1. an open **popover**
2. an active **typeahead**
3. a **filter** with text → clears it
4. an open **detail pane** → closes it, focus returns to the row that opened it
5. nothing

**Escape never changes section and never closes the app.** The fifth rung —
"nothing" — is the deliberate outcome that stops Escape from falling through to
"close the window".

## Focus restoration

The part every implementation forgets. A keyboard user who loses focus to
`document.body` has to start over from Tab.

- **Closing the detail pane** returns focus to the row that opened it.
- **Deleting a row** moves focus to the next row, or to the new last row if the
  deleted one was last (`focusIndexAfterRemoval`). Only when the list becomes
  empty does focus move deliberately to the empty state's primary action —
  never to the body.
- **A rescan that reorders the list** keeps focus on the *item*, not the index
  (`focusIndexAfterReorder`): sorting a four-gigabyte `node_modules` to the top
  must not drag focus to whatever now sits where the user was.

## Announcements

`aria-live="polite"` carries the scan progress and the result of operations (the
`<OutcomeSummary>` from #19) — because the count is the information, not the
decoration, and a screen-reader user must hear it.
