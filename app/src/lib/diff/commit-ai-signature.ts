import { GitAuthor } from '../../models/git-author'

/**
 * Commit-signature-derived AI attribution — the pure, deterministic core.
 *
 * Issue #70. The question "which lines of this diff did an AI write?" is
 * answered from git itself: the commit's authorship signature. A commit made
 * with AI assistance carries an AI identity in its authorship — conventionally
 * the `Co-Authored-By:` trailer (e.g. `Co-Authored-By: Claude
 * <noreply@anthropic.com>`), which Blackfin and common AI tools already write.
 * A commit WITHOUT such a marker was made without AI.
 *
 * This module is the honest, testable half: given a commit message (and,
 * optionally, its author/committer identities) plus a configurable set of AI
 * markers, it classifies the commit as `ai` or `human`; and given each line's
 * originating commit sha (from `git blame`) plus a sha→classification map, it
 * derives the per-line verdict `ai | non-ai | uncommitted`.
 *
 * It is PURE: no I/O, no throwing. Every function returns a result. The actual
 * `git blame` invocation (dugite I/O) and the gutter rendering / config UI are
 * DEFERRED to a follow-up runtime layer that consumes these functions — see the
 * note at the bottom of this file. #98/#101 (the superseded `agent | unknown`
 * line-range model in `attribution-range.ts` / `diff-attribution.ts`) are NOT
 * used here and must not be imported.
 */

/** A single author identity, as it appears in a commit's authorship. */
export interface ICoAuthor {
  readonly name: string
  readonly email: string
}

/**
 * Matches the standard git `Co-Authored-By: Name <email>` trailer line. The key
 * is matched case-insensitively (git treats trailer tokens case-insensitively);
 * the value is handed to {@link GitAuthor.parse} for the `Name <email>` split.
 *
 * We anchor to the start of a trimmed line so that only genuine trailer lines
 * (not prose that happens to mention the phrase mid-sentence) are considered.
 */
const CoAuthoredByLineRe = /^co-authored-by\s*:\s*(.+)$/i

/**
 * Parse the `Co-Authored-By:` trailers out of a raw commit message.
 *
 * This is the pure, dependency-free counterpart to `parseTrailers` in
 * `app/src/lib/git/interpret-trailers.ts`, which relies on `git
 * interpret-trailers` (I/O). We reuse {@link GitAuthor.parse} — the same
 * `Name <email>` parser the co-author feature already uses — for the value so
 * behaviour stays consistent with the rest of the app.
 *
 * - Zero, one, or many co-authors are supported.
 * - The trailer key is matched case-insensitively.
 * - Malformed lines (missing `<email>`, empty value, etc.) are ignored.
 *
 * @param commitMessage A commit message (summary + body), possibly empty.
 * @returns Zero or more parsed co-authors, in the order they appear.
 */
export function parseCoAuthors(
  commitMessage: string
): ReadonlyArray<ICoAuthor> {
  const coAuthors = new Array<ICoAuthor>()

  if (commitMessage.length === 0) {
    return coAuthors
  }

  // Normalize CRLF/CR so line scanning is platform-independent.
  const lines = commitMessage.replace(/\r\n?/g, '\n').split('\n')

  for (const rawLine of lines) {
    const match = CoAuthoredByLineRe.exec(rawLine.trim())
    if (match === null) {
      continue
    }

    const parsed = GitAuthor.parse(match[1].trim())
    if (parsed === null) {
      // Malformed value (e.g. no `<email>`); ignore, don't throw.
      continue
    }

    coAuthors.push({ name: parsed.name, email: parsed.email })
  }

  return coAuthors
}

/**
 * A configurable set of markers identifying an AI authorship signature.
 *
 * Matching (see {@link identityMatchesMarkers}) is case-insensitive.
 * - `emails` match the identity's email exactly (case-insensitively).
 * - `names` match as a case-insensitive substring of the identity's name.
 *   Substring matching is deliberate and conservative: AI tools write names
 *   like "Claude", "Claude Code", or "Claude Opus 4.8 (1M context)" — all of
 *   which should match a single "claude" name marker — while an exact-email
 *   match keeps the higher-signal identifier strict.
 */
export interface IAIAuthorMarkers {
  readonly names: ReadonlyArray<string>
  readonly emails: ReadonlyArray<string>
}

/**
 * A conservative default set of AI authorship markers.
 *
 * Kept intentionally small and well-known so a human author is never
 * misclassified as AI:
 * - `noreply@anthropic.com` — the email Blackfin and Claude tooling write in
 *   their `Co-Authored-By:` trailers.
 * - name "Claude" — substring-matches the family of Claude author names above.
 *
 * Runtime layers should treat this as a starting default and let the user
 * extend it (issue #70 requires the marker set to be configurable).
 */
export const DefaultAIAuthorMarkers: IAIAuthorMarkers = {
  names: ['Claude'],
  emails: ['noreply@anthropic.com'],
}

/** Does a single identity match any AI marker? Case-insensitive. */
function identityMatchesMarkers(
  identity: ICoAuthor,
  markers: IAIAuthorMarkers
): boolean {
  const email = identity.email.trim().toLowerCase()
  if (email.length > 0) {
    for (const markerEmail of markers.emails) {
      if (email === markerEmail.trim().toLowerCase()) {
        return true
      }
    }
  }

  const name = identity.name.trim().toLowerCase()
  if (name.length > 0) {
    for (const markerName of markers.names) {
      const needle = markerName.trim().toLowerCase()
      if (needle.length > 0 && name.includes(needle)) {
        return true
      }
    }
  }

  return false
}

/** The AI-attribution verdict for a single commit. */
export type CommitAuthorship = 'ai' | 'human'

/**
 * The authorship signature of a commit: its author, optional committer, and any
 * co-authors. All fields are optional so callers can pass whatever git gives
 * them; typically the author and co-authors (parsed via {@link parseCoAuthors})
 * are enough.
 */
export interface ICommitAuthorshipInput {
  readonly author?: ICoAuthor
  readonly committer?: ICoAuthor
  readonly coAuthors?: ReadonlyArray<ICoAuthor>
}

/**
 * Classify a commit as `ai` or `human` from its authorship signature.
 *
 * A commit is `ai` if its author, its committer, OR any co-author matches an AI
 * marker. Otherwise it is `human`. Pure and total.
 *
 * @param input   The commit's author/committer/co-author identities.
 * @param markers The AI markers to match against (defaults to
 *                {@link DefaultAIAuthorMarkers}).
 */
export function classifyCommitAuthorship(
  input: ICommitAuthorshipInput,
  markers: IAIAuthorMarkers = DefaultAIAuthorMarkers
): CommitAuthorship {
  const identities = new Array<ICoAuthor>()

  if (input.author !== undefined) {
    identities.push(input.author)
  }
  if (input.committer !== undefined) {
    identities.push(input.committer)
  }
  if (input.coAuthors !== undefined) {
    for (const coAuthor of input.coAuthors) {
      identities.push(coAuthor)
    }
  }

  for (const identity of identities) {
    if (identityMatchesMarkers(identity, markers)) {
      return 'ai'
    }
  }

  return 'human'
}

/** The AI-attribution verdict for a single line of a file/diff. */
export type LineAuthorship = 'ai' | 'non-ai' | 'uncommitted'

/**
 * A sentinel line-commit value meaning "this line is not committed yet"
 * (working-directory / staged change with no blame commit). Callers producing
 * per-line commit shas from `git blame` should emit this (or `null`) for lines
 * that have no originating commit.
 *
 * `git blame` uses an all-zero sha for uncommitted lines; we accept that too.
 */
export const UncommittedLineSha = null

/** All-zero blame sha that `git blame` emits for not-yet-committed lines. */
const ZeroBlameSha = /^0{7,40}$/

/**
 * Map each line's originating commit to its AI-attribution verdict — the pure
 * half of the `git blame` integration.
 *
 * @param perLineCommit    One entry per line, in file order: the sha of the
 *                         commit that introduced the line, or `null`
 *                         ({@link UncommittedLineSha}) / an all-zero sha for a
 *                         not-yet-committed (working-directory) line.
 * @param authorshipByCommit A map from commit sha to its
 *                         {@link CommitAuthorship}. A line whose sha is missing
 *                         from the map is treated as `uncommitted` (no verdict
 *                         rather than a guessed one — never read absence as
 *                         "human").
 * @returns One {@link LineAuthorship} per input line, in the same order.
 */
export function lineAuthorships(
  perLineCommit: ReadonlyArray<string | null>,
  authorshipByCommit: ReadonlyMap<string, CommitAuthorship>
): ReadonlyArray<LineAuthorship> {
  return perLineCommit.map(sha => {
    if (sha === null || sha.length === 0 || ZeroBlameSha.test(sha)) {
      return 'uncommitted'
    }

    const authorship = authorshipByCommit.get(sha)
    if (authorship === undefined) {
      // Unknown commit: no signature to read, so no verdict. Do NOT default to
      // "human" — absence of evidence is not evidence of a human author.
      return 'uncommitted'
    }

    return authorship === 'ai' ? 'ai' : 'non-ai'
  })
}

// DEFERRED (follow-up PRs, not this one):
//   1. The runtime `git blame` invocation (dugite I/O in `app/src/lib/git/`)
//      that produces `perLineCommit` shas and reads each commit's authorship
//      signature to build the sha→CommitAuthorship map consumed above.
//   2. The gutter rendering in `SideBySideDiffRow.renderLineNumber()`
//      (colour + shape for colour-blindness, light/dark) and the hover
//      revealing the matched commit.
//   3. The configuration UI for the recognized AI marker set.
// This module is the deterministic classification core only.
