import { IDiffAnchor, DiffAnchorResolution } from '../lib/diff/diff-anchor'

// Local review annotations: the honest data model (#68).
//
// You review a colleague's code by commenting on their diff. You review an
// agent's code by staring at a terminal and typing a paragraph of prose that
// describes, more or less, where the problem is. This model is the missing
// primitive: pin a note to a *line* of a diff and let the notes accumulate.
//
// The whole point of accumulating (rather than sending each note as you write
// it) is #69: hand the agent all ten notes at once, as one prompt, so it sees
// the whole of what is wrong instead of oscillating between fixing A and
// breaking B. This model is only the accumulation; nothing here sends anything.
//
// This file is pure types plus a few pure, total helpers. Two rules are
// enforced by the type, not by discipline:
//   1. What a note pins to is an `IDiffAnchor` (#67) — NEVER a `diffLineNumber`.
//      A render index slides the moment a hunk expands, and a note that silently
//      slides onto the wrong line is a review tool lying about where the problem
//      is. The anchor is what survives a re-diff.
//   2. The `body` is UNTRUSTED input. It is written by the user, but it will be
//      rendered as markdown and — in #69 — concatenated into an agent prompt. It
//      is never HTML, never trusted, and it is length-capped so an accidental
//      paste of a whole file does not become a megabyte row (and then a megabyte
//      prompt).

/**
 * The lifecycle of an annotation. `unresolved` is the default; `resolved`
 * collapses the thread but keeps the note — it is never deleted, because in #69
 * the unresolved ones are exactly what enters the next batch, and that is what
 * makes the review loop converge instead of wander.
 */
export type DiffAnnotationState = 'unresolved' | 'resolved'

/**
 * The hard cap on an annotation body, in characters. A pasted file must not
 * become a megabyte row in the database — and, later, a megabyte prompt.
 */
export const MaxAnnotationBodyLength = 10000

/**
 * One review note, pinned to a line by a stable anchor.
 *
 * `anchor` is the ONLY addressing this model persists. There is deliberately no
 * `diffLineNumber` field: that is a render index, computed and discarded in the
 * same frame the diff is drawn (see the layout in `lib/diff/diff-annotation.ts`).
 */
export interface IDiffAnnotation {
  readonly id: number
  /**
   * `Repository.id` — the stable numeric key. NOT the path: switching worktree
   * mutates a repository's path in place, so a path key would lose or mix notes.
   */
  readonly repositoryId: number
  /** The stable address of the line. See #67. NEVER a `diffLineNumber`. */
  readonly anchor: IDiffAnchor
  /** Markdown, written by the user. UNTRUSTED — render only via SandboxedMarkdown. */
  readonly body: string
  readonly state: DiffAnnotationState
  /** Epoch milliseconds. Ties are broken by this when two notes share a line. */
  readonly createdAt: number
  readonly updatedAt: number
  /**
   * Earlier anchors, pushed here when the user re-anchors an orphan by hand. The
   * anchor is immutable; re-anchoring writes a new one and files the old one
   * here, so the trail of where a note has lived is never lost.
   */
  readonly previousAnchors?: ReadonlyArray<IDiffAnchor>
}

/**
 * An annotation together with where it landed in THIS diff. Ephemeral: the
 * resolution is recomputed against every render and never persisted. An
 * `orphaned` resolution is a member of this type, not an error — an orphan is a
 * truth (the line is gone) and a displaced note is a lie.
 */
export interface IResolvedDiffAnnotation {
  readonly annotation: IDiffAnnotation
  readonly resolution: DiffAnchorResolution
}

/**
 * Why a proposed body was rejected. `empty` — nothing but whitespace, there is
 * no note to save. `too-long` — over {@link MaxAnnotationBodyLength}.
 */
export type AnnotationBodyRejection = 'empty' | 'too-long'

/**
 * The result of validating a body. A discriminated union, never an exception:
 * the composer shows the reason inline, it does not catch a throw.
 */
export type AnnotationBodyValidation =
  | { readonly valid: true; readonly body: string }
  | { readonly valid: false; readonly reason: AnnotationBodyRejection }

/**
 * Validate a proposed annotation body. Pure and total. Rejects an all-whitespace
 * body and one longer than {@link MaxAnnotationBodyLength}. The length is checked
 * against the raw string (what actually gets stored), while emptiness is checked
 * against the trimmed string (whitespace alone is not a note).
 */
export function validateAnnotationBody(body: string): AnnotationBodyValidation {
  if (body.length > MaxAnnotationBodyLength) {
    return { valid: false, reason: 'too-long' }
  }
  if (body.trim().length === 0) {
    return { valid: false, reason: 'empty' }
  }
  return { valid: true, body }
}

/** Is this annotation unresolved? The state that feeds the next batch in #69. */
export function isAnnotationUnresolved(annotation: IDiffAnnotation): boolean {
  return annotation.state === 'unresolved'
}
