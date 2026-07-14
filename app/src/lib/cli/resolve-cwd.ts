// Resolve the directory a CLI request arrived from to the repository and
// worktree that contain it (#63). This is the keystone the read-only commands
// and `checkpoint` (#64) build on, so it is pure — it takes plain data, never
// touches the filesystem, and never throws.
//
// The one rule that shapes everything here: a worktree's `path` is NOT its
// identity. Switching worktrees mutates the `path` of the existing Repository
// row (repositories-store.ts `switchWorktree`), so the stable anchor is the
// common git dir. This function matches a cwd against worktree paths to *find*
// the worktree, but the identity it hands back is the repository's
// `commonGitDir` — never the mutable path.

import * as Path from 'path'

/** A worktree the app already knows, as far as resolution needs it. */
export interface ICwdWorktree {
  /** The absolute worktree root — matched against the cwd, not used as identity. */
  readonly path: string
  /** Full ref (e.g. `refs/heads/main`), or `null` when HEAD is detached. */
  readonly branch: string | null
  readonly isMain: boolean
}

/** A repository the app already knows. `commonGitDir` is its stable identity. */
export interface ICwdRepository {
  readonly name: string
  /** The common git dir — the stable anchor, never the mutable worktree path. */
  readonly commonGitDir: string
  readonly worktrees: ReadonlyArray<ICwdWorktree>
}

export type ICwdResolution =
  | {
      readonly kind: 'resolved'
      readonly repository: ICwdRepository
      readonly worktree: ICwdWorktree
    }
  | { readonly kind: 'not-in-repository' }

/** Whether `target` is at or below `root`, by path structure — never string prefix. */
function contains(root: string, target: string): boolean {
  if (root === target) {
    return true
  }
  // `Path.relative` normalizes both sides, so `/a/b` vs `/a/b-c` yields
  // `../b-c` (rejected) rather than a false string-prefix match, and a
  // different Windows drive yields an absolute path (also rejected).
  const rel = Path.relative(root, target)
  return rel.length > 0 && !rel.startsWith('..') && !Path.isAbsolute(rel)
}

/**
 * Find the repository and worktree that contain `cwd`. When worktrees nest (a
 * repository checked out inside another's worktree, a submodule), the most
 * specific — the longest matching root — wins, so an agent is never told it is
 * in the outer repository when it is really in the inner one. Returns
 * `not-in-repository` when the cwd is under no known worktree.
 */
export function resolveCwd(
  cwd: string,
  repositories: ReadonlyArray<ICwdRepository>
): ICwdResolution {
  const target = Path.resolve(cwd)
  let best: {
    repository: ICwdRepository
    worktree: ICwdWorktree
    length: number
  } | null = null

  for (const repository of repositories) {
    for (const worktree of repository.worktrees) {
      const root = Path.resolve(worktree.path)
      if (!contains(root, target)) {
        continue
      }
      if (best === null || root.length > best.length) {
        best = { repository, worktree, length: root.length }
      }
    }
  }

  return best === null
    ? { kind: 'not-in-repository' }
    : {
        kind: 'resolved',
        repository: best.repository,
        worktree: best.worktree,
      }
}
