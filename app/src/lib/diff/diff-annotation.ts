import { IDiff } from '../../models/diff/diff-data'
import {
  IDiffAnnotation,
  IResolvedDiffAnnotation,
  isAnnotationUnresolved,
} from '../../models/diff-annotation'
import {
  IResolveOptions,
  anchorResolutionToDiffLineNumber,
  resolveDiffAnchors,
} from './diff-anchor'

// The pure core of diff annotations (#68).
//
// The model in `models/diff-annotation.ts` says what a note *is* and pins it to
// a stable anchor (#67). This module is what turns that stored anchor back into
// a place ON SCREEN: given the annotations of one file and the diff currently
// drawn for it, it decides which render row each note sits on, and which notes
// have been orphaned because their line no longer exists.
//
// It is pure: no fs, no Dexie, no React, no clock, no git. It reads only its
// arguments and returns plain data. And it NEVER throws — a non-text diff, an
// annotation whose file is not this one, a line that has vanished are all
// ordinary *results* (an orphan, an empty map), because a review tool that
// crashes on odd input is a review tool that stops being trusted.
//
// The one discipline the whole feature rests on lives here: the `diffLineNumber`
// this module produces is a KEY of a map that is rebuilt every render and thrown
// away every render. It is never returned to the store, never persisted. The
// anchor is identity; the diff line is a coordinate on today's picture. Confuse
// the two and an annotation drifts onto the wrong line the first time a hunk
// expands — which is the exact bug #67 exists to prevent.

/**
 * The placement of every annotation of one file against the diff on screen.
 *
 * `byDiffLine` is the hot lookup the row renderer does per line: `O(1)` from a
 * render line number to the notes sitting under it. Its keys are ephemeral —
 * valid for THIS diff only. `orphaned` holds the notes whose line is gone; they
 * are not on any row and belong in the "orphaned annotations" band at the top of
 * the file, with the original code preview the anchor captured.
 */
export interface IDiffAnnotationLayout {
  /**
   * Render line number -> the resolved notes on that line, ordered by
   * `createdAt` (oldest first), then `id`. A line with no notes is simply absent.
   */
  readonly byDiffLine: ReadonlyMap<
    number,
    ReadonlyArray<IResolvedDiffAnnotation>
  >
  /** Notes whose anchor resolved as `orphaned`: line gone, never displaced. */
  readonly orphaned: ReadonlyArray<IResolvedDiffAnnotation>
}

const EmptyLayout: IDiffAnnotationLayout = {
  byDiffLine: new Map(),
  orphaned: [],
}

/**
 * Order two notes deterministically: oldest `createdAt` first, ties broken by
 * `id`. Stable across renders so a line with several notes never reshuffles.
 */
function compareAnnotations(a: IDiffAnnotation, b: IDiffAnnotation): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt
  }
  return a.id - b.id
}

/**
 * Resolve a file's annotations against its current diff and lay them out for
 * rendering, in a single batch pass over the anchors.
 *
 * The anchors are resolved once, together, via `resolveDiffAnchors` (#67) — the
 * same result as resolving each on its own, but reconstructing each side of the
 * file only once instead of per note. Each non-orphaned resolution is mapped to
 * its render line number and grouped; the orphans go to their own list. An
 * annotation for a different file (its anchor path does not match) resolves as
 * `file-absent` and lands in `orphaned`, so passing the wrong file's notes is
 * safe, though callers should pass a file's own notes.
 *
 * Pure and total. `annotations` in any order yields a deterministic layout.
 */
export function placeDiffAnnotations(
  annotations: ReadonlyArray<IDiffAnnotation>,
  diff: IDiff,
  options: IResolveOptions
): IDiffAnnotationLayout {
  if (annotations.length === 0) {
    return EmptyLayout
  }

  const resolutions = resolveDiffAnchors(
    annotations.map(a => a.anchor),
    diff,
    options
  )

  const grouped = new Map<number, Array<IResolvedDiffAnnotation>>()
  const orphaned: Array<IResolvedDiffAnnotation> = []

  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i]
    const resolution = resolutions[i]
    const resolved: IResolvedDiffAnnotation = { annotation, resolution }

    if (resolution.kind === 'orphaned') {
      orphaned.push(resolved)
      continue
    }

    // Map the resolved file line back to a render index in THIS diff. This is
    // the ephemeral coordinate — recomputed every render, never stored.
    const diffLine = anchorResolutionToDiffLineNumber(
      resolution,
      diff,
      annotation.anchor.side
    )

    if (diffLine === null) {
      // The line resolved but is not currently drawn (e.g. outside every
      // rendered hunk). It is not orphaned — the note is still valid — it just
      // has no row this render, so it is placed on no line rather than moved.
      continue
    }

    const existing = grouped.get(diffLine)
    if (existing === undefined) {
      grouped.set(diffLine, [resolved])
    } else {
      existing.push(resolved)
    }
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => compareAnnotations(a.annotation, b.annotation))
  }
  orphaned.sort((a, b) => compareAnnotations(a.annotation, b.annotation))

  return { byDiffLine: grouped, orphaned }
}

/**
 * The render line numbers that carry at least one UNRESOLVED annotation. This is
 * what the diff renderer preserves from collapsing (#71) and what the gutter
 * marks — a resolved note collapses, so it does not keep a line in view. Derived
 * from a layout; the returned set is ephemeral, like the layout's keys.
 */
export function unresolvedAnnotatedDiffLines(
  layout: IDiffAnnotationLayout
): ReadonlySet<number> {
  const lines = new Set<number>()
  for (const [diffLine, resolved] of layout.byDiffLine) {
    if (resolved.some(r => isAnnotationUnresolved(r.annotation))) {
      lines.add(diffLine)
    }
  }
  return lines
}

/** The resolved notes on one render line, oldest first, or an empty array. */
export function annotationsOnDiffLine(
  layout: IDiffAnnotationLayout,
  diffLineNumber: number
): ReadonlyArray<IResolvedDiffAnnotation> {
  return layout.byDiffLine.get(diffLineNumber) ?? []
}

/**
 * How many of a file's annotations are unresolved — the per-file badge in the
 * changed-files list. Counts the notes directly, NOT a layout: the count must be
 * the same whether or not the file's diff is currently on screen (an orphaned or
 * off-screen note is still an unresolved note the user has to deal with).
 */
export function countUnresolvedAnnotations(
  annotations: ReadonlyArray<IDiffAnnotation>
): number {
  let count = 0
  for (const annotation of annotations) {
    if (isAnnotationUnresolved(annotation)) {
      count++
    }
  }
  return count
}

/**
 * Re-anchor a note to a new line the user picked for an orphan. Pure: files the
 * current anchor into `previousAnchors` (the immutable trail) and stamps
 * `updatedAt` from the supplied clock, so the caller owns the time source and
 * this stays testable. Returns a new object; the input is untouched.
 */
export function reAnchorAnnotation(
  annotation: IDiffAnnotation,
  newAnchor: IDiffAnnotation['anchor'],
  updatedAt: number
): IDiffAnnotation {
  return {
    ...annotation,
    anchor: newAnchor,
    previousAnchors: [...(annotation.previousAnchors ?? []), annotation.anchor],
    updatedAt,
  }
}
