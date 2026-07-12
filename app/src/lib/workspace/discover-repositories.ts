import { readdir, lstat } from 'fs/promises'
import * as Path from 'path'
import { isNeverWalked, classifyArtifact } from './catalog'

/**
 * Finding the git repositories inside a folder the user points us at.
 *
 * The premise of a control center is that you hand it your work, not that you
 * add your projects one at a time. So: pick the folder your projects live in,
 * and Blackfin finds them.
 */

/**
 * How deep to look. Projects nest — `~/dev/work/client/api` is depth 3 — but
 * past this the walk starts costing more than it finds.
 */
const MaxDepth = 4

export interface IDiscoveryOptions {
  readonly signal?: AbortSignal
}

/**
 * Return the paths of every git repository at or beneath `root`.
 *
 * A directory containing `.git` is a repository. `.git` is checked as an entry
 * rather than a directory because a **linked worktree's `.git` is a file**, not
 * a directory, and a worktree is every bit as much a checkout as its parent.
 *
 * We do not descend into a repository once found. Nested repositories are
 * almost always submodules or vendored copies, and adding somebody's submodules
 * as top-level projects would be a mess they then have to clean up by hand.
 */
export async function discoverRepositories(
  root: string,
  options: IDiscoveryOptions = {}
): Promise<ReadonlyArray<string>> {
  const found: Array<string> = []
  await walk(root, 0, found, options)
  return found
}

async function walk(
  directory: string,
  depth: number,
  found: Array<string>,
  options: IDiscoveryOptions
): Promise<void> {
  options.signal?.throwIfAborted()

  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    // An unreadable directory is not a reason to abandon the search.
    return
  }

  if (entries.some(e => e.name === '.git')) {
    found.push(directory)
    return
  }

  if (depth >= MaxDepth) {
    return
  }

  const names = new Set(entries.map(e => e.name))

  for (const entry of entries) {
    options.signal?.throwIfAborted()

    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue
    }

    if (isNeverWalked(entry.name)) {
      continue
    }

    // No repository worth having lives inside node_modules or a build
    // directory, and walking them would make this cost minutes.
    if (classifyArtifact(entry.name, name => names.has(name)) !== null) {
      continue
    }

    await walk(Path.join(directory, entry.name), depth + 1, found, options)
  }
}

/** Whether a path is itself a git repository. */
export async function isRepository(path: string): Promise<boolean> {
  try {
    await lstat(Path.join(path, '.git'))
    return true
  } catch {
    return false
  }
}
