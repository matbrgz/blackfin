import { ITask } from '../../models/task'
import { IBranchNamePreset } from '../../models/branch-preset'
import { sanitizedRefName } from '../sanitize-ref-name'

/**
 * The longest slug this produces. A branch name built from a 200-character
 * issue title is nobody's friend; the final name also passes through the fork's
 * branch presets, which may prefix it further.
 */
export const MaxBranchSlugLength = 60

/**
 * A deterministic, filesystem- and git-safe branch-name *candidate* for a task.
 *
 * It is only a candidate: the final name still goes through the fork's existing
 * `sanitize-ref-name.ts` and its branch presets — Blackfin does not invent a
 * second naming convention. The output here is already lowercase `[a-z0-9-]`
 * with no leading or trailing hyphen, so `sanitizedRefName` leaves it unchanged.
 */
export function slugifyTaskForBranch(task: ITask): string {
  const slug = `${task.displayId} ${task.title}`
    // Decompose accented characters, then drop the non-ASCII part. `NFKD` turns
    // "á" into "a" + a combining mark; removing non-ASCII strips the mark and
    // keeps the base letter. Characters with no ASCII decomposition (emoji, CJK)
    // fall away entirely and become word separators below.
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    // Any run of non-alphanumeric — spaces, slashes, punctuation — becomes a
    // single hyphen.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MaxBranchSlugLength)
    // A slice can leave a trailing hyphen; trim it again.
    .replace(/-+$/g, '')

  // Everything slugged away (a title that was only emoji, say) still needs a
  // non-empty, valid ref.
  return slug.length > 0 ? slug : 'task'
}

/** Options for `proposeBranchNameForTask`. All optional; all pure inputs. */
export interface IProposeBranchNameOptions {
  /**
   * A branch preset already resolved by the fork's preset machine
   * (`branch-preset.ts`). Its `name` is used as a prefix, e.g. `feature/` gives
   * `feature/123-fix-token`. Blackfin does not invent a second convention: when
   * the user has a preset, it wins. Null or undefined means no prefix.
   */
  readonly preset?: IBranchNamePreset | null
  /**
   * Branch names that already exist, so a collision is resolved deterministically
   * by appending `-2`, `-3`, … rather than proposing a name `git` would reject.
   * Compared case-insensitively because branch names collide case-insensitively
   * on the default macOS/Windows filesystems.
   */
  readonly existingBranchNames?: Iterable<string>
}

/** The outcome of `proposeBranchNameForTask` — a valid ref plus how it was reached. */
export interface IProposeBranchNameResult {
  /** The final, sanitized, collision-free branch name. Always a valid, non-empty ref. */
  readonly name: string
  /** The slug the name was built from, before prefix and de-duplication. */
  readonly slug: string
  /** True when a numeric suffix was appended to dodge an existing branch. */
  readonly deduped: boolean
}

/**
 * The largest numeric suffix `proposeBranchNameForTask` will try before it gives
 * up and returns the last candidate anyway. A user with 9,999 branches that all
 * collide on one slug has a bigger problem than a duplicate name.
 */
const MaxDedupeAttempts = 10000

/**
 * Propose a valid git branch name for a task — PURE, DETERMINISTIC, NEVER THROWS.
 *
 * It composes `slugifyTaskForBranch()` (#72) with an optional resolved preset
 * prefix, runs the whole thing through the fork's existing `sanitizedRefName`
 * (so a hostile third-party title — `--upload-pack=x`, `; rm -rf ~`, `../..`,
 * `@{` — can never reach a `git` argument as a flag or a traversal), and finally
 * resolves collisions against `existingBranchNames` by appending `-2`, `-3`, …
 *
 * It returns a result rather than a bare string so the caller can tell a
 * de-duplicated name from a pristine one without re-deriving it. Persisting the
 * link, running `git checkout -b`/`addWorktree`, and executing the user's preset
 * *script* are all deferred to the store/dispatcher slice — this function does
 * no I/O.
 */
export function proposeBranchNameForTask(
  task: ITask,
  options: IProposeBranchNameOptions = {}
): IProposeBranchNameResult {
  const slug = slugifyTaskForBranch(task)

  const prefix = normalizePresetPrefix(options.preset)
  const base = ensureValidRef(sanitizedRefName(`${prefix}${slug}`))

  const taken = new Set<string>()
  for (const name of options.existingBranchNames ?? []) {
    taken.add(name.toLowerCase())
  }

  if (!taken.has(base.toLowerCase())) {
    return { name: base, slug, deduped: false }
  }

  for (let attempt = 2; attempt < MaxDedupeAttempts; attempt++) {
    const candidate = ensureValidRef(sanitizedRefName(`${base}-${attempt}`))
    if (!taken.has(candidate.toLowerCase())) {
      return { name: candidate, slug, deduped: true }
    }
  }

  // Every candidate collided. Return the base anyway — a duplicate name is a
  // problem the caller can surface, an exception from a pure helper is not.
  return { name: base, slug, deduped: true }
}

/**
 * Turn a preset into a usable prefix. A preset like `feature/` is used verbatim;
 * a preset like `feature` (no separator) gains a trailing `/`. An empty or
 * whitespace-only preset contributes nothing.
 */
function normalizePresetPrefix(
  preset: IBranchNamePreset | null | undefined
): string {
  const raw = (preset?.name ?? '').trim()
  if (raw.length === 0) {
    return ''
  }
  return raw.endsWith('/') ? raw : `${raw}/`
}

/**
 * Guarantee a non-empty ref even if sanitizing stripped everything (a preset of
 * only illegal characters, say). `sanitizedRefName` can return an empty string
 * or a lone `/`; neither is a valid branch name.
 */
function ensureValidRef(name: string): string {
  const trimmed = name.replace(/^\/+|\/+$/g, '')
  return trimmed.length > 0 ? trimmed : 'task'
}
