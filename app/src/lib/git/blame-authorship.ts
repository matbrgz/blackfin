import { git } from './core'
import { Repository } from '../../models/repository'
import { createLogParser } from './git-delimiter-parser'
import {
  CommitAuthorship,
  DefaultAIAuthorMarkers,
  IAIAuthorMarkers,
  ICoAuthor,
  LineAuthorship,
  classifyCommitAuthorship,
  lineAuthorships,
  parseCoAuthors,
} from '../diff/commit-ai-signature'

/**
 * The git data layer for issue #70's commit-signature-derived AI attribution.
 *
 * The deterministic classification core lives in
 * `app/src/lib/diff/commit-ai-signature.ts` (merged): it exports
 * {@link classifyCommitAuthorship}, {@link lineAuthorships},
 * {@link parseCoAuthors} and {@link DefaultAIAuthorMarkers}. This module is the
 * GIT half that feeds it: it runs `git blame` to learn which commit introduced
 * each line, reads each of those commits' author + full message (so the
 * `Co-Authored-By:` trailers are available), and reuses the merged classifier to
 * produce the per-line {@link LineAuthorship} verdict.
 *
 * Two responsibilities, deliberately separated:
 *
 *   1. {@link parseBlamePorcelain} — a PURE, exported parser of
 *      `git blame --porcelain` output. No I/O, never throws. Unit-tested with
 *      fixtures (see `app/test/unit/blame-authorship-test.ts`).
 *   2. {@link getBlameAuthorship} — the I/O function that shells out to git via
 *      the {@link git} helper (dugite) and stitches the pure pieces together.
 *      On ANY git failure it returns an empty map rather than throwing — the
 *      caller renders the honest "no attribution" state.
 *
 * DEFERRED (needs the running app; the maintainer verifies visually):
 *   - the gutter rendering in `SideBySideDiffRow.renderLineNumber()`
 *     (colour + shape for colour-blindness, light/dark, hover reveals the
 *     matched commit);
 *   - the store / dispatcher wiring that calls {@link getBlameAuthorship} and
 *     threads the result into the diff view;
 *   - the configuration UI for the recognized AI marker set.
 */

/** Per-line blame result: the sha that introduced a line, or `null` if it is
 * not yet committed (working-directory / boundary line). */
export interface IBlameLineCommit {
  /** The 1-based final-file line number this entry describes. */
  readonly line: number
  /** The introducing commit sha, or `null` for an uncommitted/boundary line. */
  readonly sha: string | null
}

/** The authorship metadata `git blame --porcelain` reports for a commit the
 * first time that commit appears in the output. */
export interface IBlameCommitInfo {
  /** The commit's full sha as it appeared in the blame header. */
  readonly sha: string
  /** The commit's author identity, or `null` if blame did not report one. */
  readonly author: ICoAuthor | null
  /** The commit's one-line summary, or `null` if blame did not report one. */
  readonly summary: string | null
}

/** The structured result of {@link parseBlamePorcelain}. */
export interface IParsedBlame {
  /** One entry per blamed line, in file order. */
  readonly lineCommits: ReadonlyArray<IBlameLineCommit>
  /** Metadata for each distinct real commit seen, keyed by full sha. */
  readonly commits: ReadonlyMap<string, IBlameCommitInfo>
}

/**
 * Matches a `git blame --porcelain` group header:
 *   `<40-hex-sha> <orig-line> <final-line> [<num-lines>]`
 * The trailing group-size field is only present on the first line of a group.
 */
const BlameHeaderRe = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/

/** All-zero blame sha that `git blame` emits for not-yet-committed lines. */
const ZeroBlameShaRe = /^0{40}$/

/** Strip the surrounding angle brackets from an `author-mail <email>` value. */
function stripAngleBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Parse `git blame --porcelain` output into a per-line sha map plus the
 * per-commit author/summary metadata.
 *
 * This is PURE and never throws: malformed or unexpected input yields whatever
 * could be parsed (possibly empty), never an exception.
 *
 * The porcelain format emits, per output line, a header
 * `<sha> <origLine> <finalLine> [<numLines>]`, an extended block of
 * `author`/`author-mail`/`summary`/… fields the FIRST time a given sha appears,
 * and finally the line content prefixed with a literal `\t`. We key the line
 * off the final-file line number in the header, and treat the all-zero
 * boundary sha as {@link IBlameLineCommit.sha} `= null` (uncommitted).
 */
export function parseBlamePorcelain(stdout: string): IParsedBlame {
  const lineCommits = new Array<IBlameLineCommit>()
  const commits = new Map<string, IBlameCommitInfo>()

  if (stdout.length === 0) {
    return { lineCommits, commits }
  }

  // Normalize CRLF/CR so scanning is platform-independent. Note: git blame
  // porcelain separates records with real '\n' and prefixes content with a
  // real '\t'; we work with those via escapes only.
  const lines = stdout.replace(/\r\n?/g, '\n').split('\n')

  let currentSha: string | null = null
  let currentFinalLine: number | null = null
  // Mutable accumulators for the commit currently being described.
  let pendingAuthorName: string | null = null
  let pendingAuthorMail: string | null = null
  let pendingSummary: string | null = null

  const flushPendingCommit = () => {
    if (currentSha === null || ZeroBlameShaRe.test(currentSha)) {
      return
    }
    if (commits.has(currentSha)) {
      return
    }
    // Only record when blame actually gave us an extended block for this sha.
    if (
      pendingAuthorName === null &&
      pendingAuthorMail === null &&
      pendingSummary === null
    ) {
      return
    }

    const author: ICoAuthor | null =
      pendingAuthorName !== null || pendingAuthorMail !== null
        ? { name: pendingAuthorName ?? '', email: pendingAuthorMail ?? '' }
        : null

    commits.set(currentSha, {
      sha: currentSha,
      author,
      summary: pendingSummary,
    })
  }

  for (const rawLine of lines) {
    if (rawLine.startsWith('\t')) {
      // A content line closes the current commit's extended block (if any) and
      // records the mapping for the header's final line number.
      flushPendingCommit()
      pendingAuthorName = null
      pendingAuthorMail = null
      pendingSummary = null

      if (currentFinalLine !== null) {
        lineCommits.push({
          line: currentFinalLine,
          sha:
            currentSha === null || ZeroBlameShaRe.test(currentSha)
              ? null
              : currentSha,
        })
      }
      continue
    }

    const header = BlameHeaderRe.exec(rawLine)
    if (header !== null) {
      currentSha = header[1]
      currentFinalLine = Number.parseInt(header[3], 10)
      continue
    }

    // Extended-block fields (only present the first time a sha appears).
    if (rawLine.startsWith('author-mail ')) {
      pendingAuthorMail = stripAngleBrackets(
        rawLine.slice('author-mail '.length)
      )
    } else if (rawLine.startsWith('author ')) {
      pendingAuthorName = rawLine.slice('author '.length).trim()
    } else if (rawLine.startsWith('summary ')) {
      pendingSummary = rawLine.slice('summary '.length)
    }
    // All other porcelain fields (author-time, committer*, previous, filename,
    // boundary, …) are intentionally ignored here.
  }

  return { lineCommits, commits }
}

/**
 * Produce the per-line AI-attribution verdict for a file, derived from the
 * commit signatures of the commits that introduced each line.
 *
 * Runs `git blame --porcelain` for `filePath`, reads each distinct real
 * commit's author + full message (via `git log`, so `Co-Authored-By:` trailers
 * are visible), classifies each commit with the merged
 * {@link classifyCommitAuthorship}, and maps every line to its
 * {@link LineAuthorship} via {@link lineAuthorships}. Uncommitted / boundary
 * lines are `'uncommitted'`.
 *
 * On ANY git failure (blame or log) this returns an EMPTY map and never throws;
 * the caller then renders the honest "no attribution" state.
 *
 * @param repository The repository whose working tree holds the file.
 * @param filePath   The file to blame, relative to the repository root.
 * @param markers    The configurable AI markers (defaults to
 *                   {@link DefaultAIAuthorMarkers}).
 * @returns A map from 1-based line number to its {@link LineAuthorship}.
 */
export async function getBlameAuthorship(
  repository: Repository,
  filePath: string,
  markers: IAIAuthorMarkers = DefaultAIAuthorMarkers
): Promise<ReadonlyMap<number, LineAuthorship>> {
  const empty: ReadonlyMap<number, LineAuthorship> = new Map()

  try {
    const blameResult = await git(
      ['blame', '--porcelain', '--', filePath],
      repository.path,
      'getBlameAuthorship'
    )

    const { lineCommits } = parseBlamePorcelain(blameResult.stdout)

    if (lineCommits.length === 0) {
      return empty
    }

    const uniqueShas = new Set<string>()
    for (const { sha } of lineCommits) {
      if (sha !== null) {
        uniqueShas.add(sha)
      }
    }

    const authorshipByCommit = uniqueShas.size
      ? await getAuthorshipByCommit(repository, [...uniqueShas], markers)
      : new Map<string, CommitAuthorship>()

    const perLineVerdict = lineAuthorships(
      lineCommits.map(entry => entry.sha),
      authorshipByCommit
    )

    const result = new Map<number, LineAuthorship>()
    lineCommits.forEach((entry, index) => {
      result.set(entry.line, perLineVerdict[index])
    })

    return result
  } catch {
    // Any git failure (not a repo, unknown path, blame refused, …) yields no
    // attribution rather than an error — the caller renders the neutral state.
    return empty
  }
}

/**
 * Read the author identity and full message of each `shas` commit and classify
 * it with {@link classifyCommitAuthorship}. Batched into a single `git log`
 * invocation. Returns a map from sha to its {@link CommitAuthorship}; shas git
 * could not report are simply absent (the caller treats absence as no verdict).
 */
async function getAuthorshipByCommit(
  repository: Repository,
  shas: ReadonlyArray<string>,
  markers: IAIAuthorMarkers
): Promise<ReadonlyMap<string, CommitAuthorship>> {
  const authorshipByCommit = new Map<string, CommitAuthorship>()

  if (shas.length === 0) {
    return authorshipByCommit
  }

  const { formatArgs, parse } = createLogParser({
    sha: '%H',
    authorName: '%an',
    authorEmail: '%ae',
    // Raw full message (subject + body) so parseCoAuthors sees the trailers.
    body: '%B',
  })

  // --no-walk keeps `git log` from walking ancestry: we want exactly the listed
  // commits. --no-show-signature avoids interleaving GPG output into %B.
  const result = await git(
    [
      'log',
      '--no-walk=unsorted',
      '--no-show-signature',
      '--no-color',
      ...formatArgs,
      ...shas,
    ],
    repository.path,
    'getBlameAuthorship',
    { encoding: 'buffer' }
  )

  for (const commit of parse(result.stdout)) {
    const sha = commit.sha.toString()
    if (sha.length === 0) {
      continue
    }

    const author: ICoAuthor = {
      name: commit.authorName.toString(),
      email: commit.authorEmail.toString(),
    }
    const coAuthors = parseCoAuthors(commit.body.toString())

    authorshipByCommit.set(
      sha,
      classifyCommitAuthorship({ author, coAuthors }, markers)
    )
  }

  return authorshipByCommit
}
