import { readdir } from 'fs/promises'
import * as Path from 'path'
import {
  ContextScope,
  IContextFile,
  IGlobalContext,
  emptyGlobalContext,
} from '../../models/workspace-inventory'
import { AgentHomeDirectories, MaxWalkDepth, classifyContext } from './catalog'
import { readContextFile, resolveReferences } from './context-file-reader'

/**
 * The agent context in the user's home directory.
 *
 * This matters more than it looks. A rule in `~/.claude/CLAUDE.md` applies to
 * every project you touch and is invisible from inside any of them — so when an
 * agent does something surprising in one repository, the cause may well be a
 * file that repository has never heard of. Nothing else in your toolchain shows
 * you this.
 *
 * We walk only the known agent directories, never the home directory itself.
 * Walking somebody's entire home folder would be both slow and rude.
 */
export async function scanGlobalContext(
  homePath: string,
  scannedAt: number,
  signal?: AbortSignal
): Promise<IGlobalContext> {
  const files: Array<IContextFile> = []

  try {
    for (const directory of AgentHomeDirectories) {
      signal?.throwIfAborted()
      await walk(
        Path.join(homePath, directory),
        directory,
        0,
        files,
        homePath,
        signal
      )
    }
  } catch (e) {
    if (signal?.aborted) {
      throw e
    }
    return {
      ...emptyGlobalContext(homePath, scannedAt, {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      }),
      contextFiles: files,
    }
  }

  return {
    homePath,
    scannedAt,
    status: { kind: 'ok' },
    contextFiles: await resolveReferences(homePath, files),
  }
}

async function walk(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  files: Array<IContextFile>,
  homePath: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()

  let entries
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    // The agent simply isn't installed. That's not an error, it's an answer.
    return
  }

  for (const entry of entries) {
    signal?.throwIfAborted()

    if (entry.isSymbolicLink()) {
      continue
    }

    const relativePath = `${relativeDir}/${entry.name}`
    const absolutePath = Path.join(absoluteDir, entry.name)

    if (entry.isDirectory()) {
      if (depth < MaxWalkDepth) {
        await walk(
          absolutePath,
          relativePath,
          depth + 1,
          files,
          homePath,
          signal
        )
      }
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const classification = classifyContext(relativePath)
    if (classification === null) {
      continue
    }

    const file = await readContextFile(
      absolutePath,
      relativePath,
      classification.agent,
      classification.role,
      ContextScope.Global
    )

    if (file !== null) {
      files.push(file)
    }
  }
}
