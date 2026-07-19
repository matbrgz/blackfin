// The task ↔ branch link — the PURE, git-free, store-free core of #74.
//
// This file holds the data logic and none of the plumbing. Every function here
// is a total function over in-memory `ITaskLink` values: no Dexie, no `git`, no
// `Dispatcher`. Git questions ("is this SHA an ancestor of that tip?") are asked
// through an injected predicate, so the reconcile logic is testable without a
// repository and the git layer stays the store's problem, not this module's.
//
// DEFERRED to the store/dispatcher slice, with intent:
//   - The Dexie `taskLinks` table (`tasks-database.ts` v2) and the store that
//     reads/writes it. `upsertLink` here is the pure shape of that write.
//   - `taskKey?` on `PopupType.CreateBranch` and the `Dispatcher.createBranch`
//     call that persists a link ONLY after the branch is actually created.
//   - Running `git checkout -b` / `addWorktree`, and computing `createdAtSha`
//     (the branch tip) and `worktreePath` at creation time.
//   - Wiring `AncestorPredicate` to a real `git merge-base --is-ancestor` call.
//   - The UI badges (task-on-branch, branch-on-card) that render this state.

import { ITaskLink, TaskKey } from '../../models/task'

/** All links for one task, in their given order. Never mutates the input. */
export function linksForTask(
  links: ReadonlyArray<ITaskLink>,
  key: TaskKey
): ReadonlyArray<ITaskLink> {
  return links.filter(link => link.taskKey === key)
}

/**
 * The link for an exact `(repositoryId, branchName)`, or null. This is the
 * cheap, common lookup: "does a branch with this exact name belong to a task?".
 * Renamed branches are the job of `resolveTaskForBranch`, not this.
 */
export function linkForBranch(
  links: ReadonlyArray<ITaskLink>,
  repositoryId: number,
  branchName: string
): ITaskLink | null {
  return (
    links.find(
      link =>
        link.repositoryId === repositoryId && link.branchName === branchName
    ) ?? null
  )
}

/**
 * The stable identity of a link: the triple `(taskKey, repositoryId,
 * branchName)`. Serialized unambiguously (a JSON array can't be spoofed by a
 * `branchName` that happens to contain a separator), so it can key a `Set`/`Map`
 * for de-duplication. This mirrors the Dexie unique index deferred to the store.
 */
export function taskLinkIdentity(link: ITaskLink): string {
  return JSON.stringify([link.taskKey, link.repositoryId, link.branchName])
}

/**
 * Insert `next`, or replace the existing link with the same identity — a pure
 * upsert. Re-linking the same `(taskKey, repositoryId, branchName)` updates the
 * row in place (a fresh `createdAtSha`, say) instead of duplicating it, and a
 * second branch for the same task is simply appended. Never mutates the input.
 */
export function upsertLink(
  links: ReadonlyArray<ITaskLink>,
  next: ITaskLink
): ReadonlyArray<ITaskLink> {
  const identity = taskLinkIdentity(next)
  const withoutMatch = links.filter(link => taskLinkIdentity(link) !== identity)
  return [...withoutMatch, next]
}

/**
 * "Is `ancestorSha` an ancestor of (or equal to) `tipSha`?" — the one git fact
 * the reconcile step needs, injected so this module never shells out. In
 * production this is a `git merge-base --is-ancestor` call; in tests it is a
 * lookup table.
 */
export type AncestorPredicate = (ancestorSha: string, tipSha: string) => boolean

/** A branch as the reconcile step sees it: a name and the SHA it currently points at. */
export interface IBranchTip {
  readonly name: string
  readonly tipSha: string
}

/** How a branch was matched back to its task link. */
export enum TaskLinkMatch {
  /** Exact branch-name equality — the branch was never renamed. */
  ByName = 'by-name',
  /**
   * The stored name no longer matches, but the link's `createdAtSha` is an
   * ancestor of the branch's current tip. The branch was renamed; the link
   * survives.
   */
  ByAncestry = 'by-ancestry',
}

/** The result of resolving a branch back to the task link that owns it. */
export interface IResolvedTaskLink {
  readonly link: ITaskLink
  readonly match: TaskLinkMatch
  /**
   * The name the stored link should be corrected to. Set only for a
   * `ByAncestry` match (the branch was renamed); null when the stored
   * `branchName` is already right. The caller persists the correction so the
   * link self-heals instead of rotting.
   */
  readonly correctedBranchName: string | null
}

/**
 * Resolve which task link owns a branch — the reconcile that survives a rename.
 *
 * Tried in order, exactly as #74 specifies:
 *   1. exact `branchName` equality (cheap, and the overwhelmingly common case);
 *   2. `createdAtSha` being an ancestor of the branch's current tip — verifiable
 *      by asking git, not a string heuristic — which is what re-finds a branch
 *      after `git branch -m`. On a step-2 hit the stored name is stale, so
 *      `correctedBranchName` carries the branch's current name for the caller to
 *      write back.
 *
 * Ambiguity guard for step 2: a link is only an ancestry candidate if its stored
 * `branchName` is NOT itself a currently-existing branch — a link that still
 * resolves by name to some live branch is correctly attached there and must not
 * be stolen. Among the survivors, the most recently created link wins, so the
 * choice is deterministic.
 *
 * Returns null when no link owns the branch. Never throws.
 */
export function resolveTaskForBranch(
  links: ReadonlyArray<ITaskLink>,
  repositoryId: number,
  branch: IBranchTip,
  isAncestor: AncestorPredicate,
  existingBranchNames: Iterable<string> = []
): IResolvedTaskLink | null {
  const inRepo = links.filter(link => link.repositoryId === repositoryId)

  const exact = inRepo.find(link => link.branchName === branch.name)
  if (exact !== undefined) {
    return {
      link: exact,
      match: TaskLinkMatch.ByName,
      correctedBranchName: null,
    }
  }

  const liveNames = new Set<string>(existingBranchNames)

  const candidates = inRepo
    .filter(link => !liveNames.has(link.branchName))
    .filter(link => isAncestor(link.createdAtSha, branch.tipSha))

  if (candidates.length === 0) {
    return null
  }

  const chosen = candidates.reduce((best, link) =>
    link.createdAt > best.createdAt ? link : best
  )

  return {
    link: chosen,
    match: TaskLinkMatch.ByAncestry,
    correctedBranchName: branch.name,
  }
}

/** Return `link` with its `branchName` corrected — the self-heal write, as pure data. */
export function applyCorrectedBranchName(
  link: ITaskLink,
  branchName: string
): ITaskLink {
  return { ...link, branchName }
}

/** A link paired with whether the branch it names still exists. */
export interface ITaskLinkStatus {
  readonly link: ITaskLink
  /** False when no branch named `link.branchName` currently exists — an orphan. */
  readonly branchPresent: boolean
}

/**
 * Annotate each link with whether its branch still exists — WITHOUT deleting the
 * orphans. A link whose branch was deleted is reported as absent, never removed:
 * dropping the user's data because a ref vanished is the kind of
 * irreversible-by-default act the product refuses. Removing a link is an
 * explicit user action, not a side effect of reading.
 */
export function statusOfLinks(
  links: ReadonlyArray<ITaskLink>,
  existingBranchNames: Iterable<string>
): ReadonlyArray<ITaskLinkStatus> {
  const present = new Set<string>(existingBranchNames)
  return links.map(link => ({
    link,
    branchPresent: present.has(link.branchName),
  }))
}
