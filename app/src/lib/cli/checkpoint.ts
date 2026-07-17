// The pure normalization boundary for a worktree checkpoint (#64).
//
// A checkpoint is the one string a *model* writes that Blackfin later renders,
// with emphasis, on the user's screen — so it is a vector, and this is the wall.
// Everything here is pure: no I/O, no store, no `Date.now()`. It takes the raw
// text an agent sent and returns the single plain line that is safe to persist
// and to print back into another agent's terminal, plus the warnings that ride
// along in the response envelope. It never throws — an empty result is a value
// (`text === ''`), which the caller turns into a `usage` error, not an
// exception. The normalization runs on the *server* (the renderer), before the
// write, precisely because a client-side sanitizer is one a malicious client
// skips.

import {
  MaxCheckpointLength,
  WorktreeManualStatus,
  CheckpointAuthorKind,
} from '../../models/worktree-metadata'

export { MaxCheckpointLength }

/** The result of normalizing a raw checkpoint: the clean line, plus what changed. */
export interface ICheckpointNormalization {
  /** The plain, single-line, NFC, ≤ `MaxCheckpointLength`-grapheme text. `''` = reject. */
  readonly text: string
  /** Whether the text was longer than the cap and was cut to fit. Not an error. */
  readonly truncated: boolean
  /** Human-readable notes for the response envelope's `warnings`. */
  readonly warnings: ReadonlyArray<string>
}

// Whole ANSI/OSC/CSI escape *sequences*, matched and removed as a unit — not
// just their ESC byte. A lone strip of control bytes would leave the visible
// payload of `ESC ] 0 ; pwned BEL` behind as `]0;pwned`; here the whole
// sequence goes, so `"\x1b]0;pwned\x07ok"` becomes `"ok"`. Three branches: an
// OSC (`ESC ]`) terminated by BEL or ST (`ESC \`); a CSI (`ESC [`) with its
// parameter/intermediate/final bytes; and any other two-byte escape.
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  [
    '\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)',
    '\\u001B\\[[0-9;?]*[ -/]*[@-~]',
    '\\u001B[@-Z\\\\-_]',
  ].join('|'),
  'g'
)

// Every line and paragraph break, folded to one space — a checkpoint is one
// line. CR, LF, NEL (U+0085) and the Unicode separators U+2028/U+2029.
const LINE_BREAKS = new RegExp('[\\r\\n\\u0085\\u2028\\u2029]+', 'g')

// The remaining C0/C1 control characters and DEL, once real escape sequences
// and line breaks are already gone (this also sweeps up a lone ESC byte).
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

// Bidirectional overrides and isolates. `U+202E` makes a string *display* the
// reverse of what it *is* — in a card that reads "safe to merge", that matters.
const BIDI_CONTROLS = new RegExp('[\\u202A-\\u202E\\u2066-\\u2069]', 'g')

/**
 * Segment a string into grapheme clusters, so truncation never splits a
 * composed emoji (`👨‍👩‍👧‍👦`) or a base character from its combining marks.
 * Uses `Intl.Segmenter` where present, and falls back to code points otherwise
 * (still safe: it never splits *below* a code point).
 */
function toGraphemes(text: string): ReadonlyArray<string> {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), part => part.segment)
  }
  return Array.from(text)
}

/**
 * Normalize a raw checkpoint into the one plain line that is safe to store and
 * to render. Pure and total — it never throws and never performs I/O.
 *
 * The order is deliberate: whole escape sequences first (so their payload does
 * not survive as text), then line breaks to spaces, then any residual control
 * characters, then bidi controls, then NFC, and finally a grapheme-aware
 * truncation to `MaxCheckpointLength`. An all-whitespace or empty input
 * normalizes to `''`, which the caller rejects as `usage`.
 */
export function normalizeCheckpoint(raw: string): ICheckpointNormalization {
  const warnings: Array<string> = []

  const withoutEscapes = raw.replace(ANSI_ESCAPE_SEQUENCE, '')
  const oneLine = withoutEscapes.replace(LINE_BREAKS, ' ')
  const collapsedLineBreaks = oneLine !== withoutEscapes
  const withoutControls = oneLine
    .replace(CONTROL_CHARACTERS, '')
    .replace(BIDI_CONTROLS, '')
  const removedControls = withoutEscapes !== raw || withoutControls !== oneLine

  let text = withoutControls.normalize('NFC').trim()

  if (collapsedLineBreaks) {
    warnings.push('Line breaks were collapsed — a checkpoint is a single line.')
  }
  if (removedControls) {
    warnings.push('Control or terminal escape characters were removed.')
  }

  let truncated = false
  const graphemes = toGraphemes(text)
  if (graphemes.length > MaxCheckpointLength) {
    text = graphemes.slice(0, MaxCheckpointLength).join('').trimEnd()
    truncated = true
    warnings.push(
      `Checkpoint was truncated to ${MaxCheckpointLength} characters.`
    )
  }

  return { text, truncated, warnings }
}

/**
 * The status lanes an agent may set alongside a checkpoint (`--status`), from
 * the worktree metadata model (#55). Kept as a runtime list — typed against the
 * union, so a lane the model drops fails to compile here — so the CLI can both
 * validate the flag and *list the valid lanes* in a `usage` error, letting an
 * agent correct itself on the second try without guessing.
 */
export const CheckpointStatusLanes: ReadonlyArray<WorktreeManualStatus> = [
  'todo',
  'in-progress',
  'in-review',
  'done',
  'archived',
]

/** Whether a raw `--status` value is one of the known lanes. Pure. */
export function isCheckpointStatusLane(
  value: string
): value is WorktreeManualStatus {
  return (CheckpointStatusLanes as ReadonlyArray<string>).includes(value)
}

/**
 * A checkpoint as it crosses the wire in a CLI response. A projection of the
 * stored row (#55): the plain text, who claimed it, and when. `authorId` is the
 * agent's *self-declared* name — an assertion, never verified, never used to
 * authorize anything.
 */
export interface ICLIWorktreeCheckpoint {
  readonly text: string
  readonly authorKind: CheckpointAuthorKind
  readonly authorId: string | null
  readonly updatedAt: number
}

/** The `data` of a `checkpoint set`/`get` response: the worktree and its checkpoint. */
export interface ICLICheckpointResult {
  readonly worktree: string
  readonly checkpoint: ICLIWorktreeCheckpoint | null
}
