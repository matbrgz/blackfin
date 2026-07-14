import * as Path from 'path'
import type { Repository } from '../../models/repository'
import type { WorktreeEntry, WorktreeType } from '../../models/worktree'
import { git } from './core'
import { directoryExists } from '../directory-exists'
import { readFile } from 'fs/promises'
import { MainWorktreeName } from '../../models/worktree-metadata'

export function parseWorktreePorcelainOutput(
  stdout: string
): ReadonlyArray<WorktreeEntry> {
  if (stdout.trim().length === 0) {
    return []
  }

  // With -z, worktree blocks are separated by double NUL and fields within
  // a block are separated by single NUL
  const blocks = stdout.replace(/\0$/, '').split('\0\0')
  const entries: WorktreeEntry[] = []

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\0')
    let path = ''
    let head = ''
    let branch: string | null = null
    let isDetached = false
    let isLocked = false
    let isPrunable = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        // Git for Windows will output paths using forward slashes, i.e.
        // c:/Users/niik/... but repositories added in Desktop always pass
        // through getRepositoryType which uses path.resolve to deduce the
        // absolute top level directory and that will normalize paths as well
        // so by normalizing here we can be more confident about comparing paths
        path = Path.normalize(line.substring('worktree '.length))
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        branch = line.substring('branch '.length)
      } else if (line === 'detached') {
        isDetached = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        isPrunable = true
      }
    }

    const type: WorktreeType = i === 0 ? 'main' : 'linked'
    entries.push({ path, head, branch, isDetached, type, isLocked, isPrunable })
  }

  return entries
}

export async function listWorktrees(
  repositoryOrPath: Repository | string
): Promise<ReadonlyArray<WorktreeEntry>> {
  const result = await git(
    ['worktree', 'list', '--porcelain', '-z'],
    typeof repositoryOrPath === 'string'
      ? repositoryOrPath
      : repositoryOrPath.path,
    'listWorktrees'
  )

  return parseWorktreePorcelainOutput(result.stdout)
}

export async function listWorktreesFromGitDir(
  gitDir: string
): Promise<ReadonlyArray<WorktreeEntry>> {
  const result = await git(
    ['--git-dir', gitDir, 'worktree', 'list', '--porcelain', '-z'],
    gitDir,
    'listWorktreesFromGitDir'
  )

  return parseWorktreePorcelainOutput(result.stdout)
}

export async function listWorktreesFromGitDirFallback(
  gitDir: string
): Promise<ReadonlyArray<WorktreeEntry>> {
  const commonDir = await resolveCommonGitDir(gitDir)
  const mainWorktreePath = Path.dirname(commonDir)

  if (!(await directoryExists(mainWorktreePath))) {
    return []
  }
  try {
    return listWorktrees(mainWorktreePath)
  } catch {
    return []
  }
}

/**
 * The stable identity of a worktree: its common git dir and administrative name
 * (`'(main)'` for the main worktree). Returns `null` for a *linked* worktree
 * whose `.git` file can't be read — the caller then falls back to matching by
 * path so a transient read failure doesn't orphan a live worktree. Never throws.
 *
 * The git dir is resolved the same way for both kinds: `.git` is read as a file
 * first (`gitdir: …`), which covers a linked worktree and a main worktree opened
 * with `--separate-git-dir`; if that read fails, `.git` is the conventional
 * directory and the main worktree uses it directly. `resolveCommonGitDir` then
 * walks a linked git dir up to the shared common dir, so main and linked always
 * resolve to the *same* `commonGitDir` and stay one family. The admin name is
 * the basename of the git dir, surviving `git worktree move` and branch renames.
 */
export async function resolveWorktreeIdentity(
  entry: WorktreeEntry
): Promise<{ commonGitDir: string; worktreeName: string } | null> {
  const dotGit = Path.join(entry.path, '.git')
  let gitDir: string | undefined

  try {
    const content = await readFile(dotGit, 'utf8')
    const match = /^gitdir:\s*(.+)$/m.exec(content)
    if (match !== null) {
      gitDir = Path.normalize(match[1].trim())
    }
  } catch {
    // `.git` is likely a directory (the conventional layout) — handled below.
  }

  if (gitDir === undefined) {
    if (entry.type !== 'main') {
      // A linked worktree whose `.git` file we couldn't read: identity unknown.
      return null
    }
    // Conventional main worktree: `.git` is the common dir itself.
    gitDir = Path.normalize(dotGit)
  }

  // A main worktree's git dir *is* the common dir; only a linked worktree's git
  // dir needs walking up. Routing main through `resolveCommonGitDir` would
  // misfire when the checkout folder is itself named `worktrees` (its
  // `basename(dirname(<path>/.git))` is `worktrees`, tripping that function's
  // heuristic and returning the grandparent), splitting the main worktree off
  // into its own family.
  const commonGitDir =
    entry.type === 'main'
      ? gitDir
      : Path.normalize(await resolveCommonGitDir(gitDir))
  const worktreeName =
    entry.type === 'main' ? MainWorktreeName : Path.basename(gitDir)
  return { commonGitDir, worktreeName }
}

export async function resolveCommonGitDir(gitDir: string): Promise<string> {
  if (Path.basename(Path.dirname(gitDir)) !== 'worktrees') {
    return gitDir
  }

  // Prefer the `commondir` file, but fall back to the conventional layout (two
  // levels up) when it's unreadable, e.g. `git worktree remove` deleted the
  // worktree's admin files too.
  const conventionalCommonDir = Path.dirname(Path.dirname(gitDir))
  try {
    const fileContent = await readFile(Path.join(gitDir, 'commondir'), 'utf8')
    const path = fileContent.replace(/\r?\n$/, '')
    return path ? Path.resolve(gitDir, path) : conventionalCommonDir
  } catch {
    return conventionalCommonDir
  }
}

export async function addWorktree(
  repository: Repository,
  path: string,
  options: {
    /** Branch name used with -b (create new branch) */
    readonly createBranch?: string
    /** Commit-ish to check out (branch name, ref, or SHA) */
    readonly commitish?: string
  } = {}
): Promise<void> {
  const args = ['worktree', 'add']

  if (options.createBranch) {
    args.push('-b', options.createBranch)
  }

  args.push(path)

  if (options.commitish) {
    args.push(options.commitish)
  }

  await git(args, repository.path, 'addWorktree')
}

export async function removeWorktree(
  repositoryPath: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  const args = ['worktree', 'remove']
  if (force) {
    args.push('--force')
  }
  args.push(worktreePath)

  await git(args, repositoryPath, 'removeWorktree')
}

export async function moveWorktree(
  repository: Repository,
  oldPath: string,
  newPath: string
): Promise<void> {
  await git(
    ['worktree', 'move', oldPath, newPath],
    repository.path,
    'moveWorktree'
  )
}
