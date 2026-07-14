import { ITask } from '../../models/task'

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
