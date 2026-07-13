import { readdir, readFile, lstat, stat } from 'fs/promises'
import * as Path from 'path'
import {
  ContextScope,
  IArtifactDirectory,
  IContextFile,
  IDocFile,
  IRepositoryInventory,
  emptyInventory,
} from '../../models/workspace-inventory'
import {
  MaxWalkDepth,
  classifyArtifact,
  classifyContext,
  isDoc,
  isNeverWalked,
} from './catalog'
import {
  MaxParsedFileSize,
  readContextFile,
  resolveReferences,
} from './context-file-reader'
import { countLines, parseTitle } from './parse'

/**
 * Scanning a repository: the I/O boundary. Everything interesting is in
 * `catalog.ts` and `parse.ts`, which are pure. This file walks a disk and
 * refuses to throw while doing it.
 */

export interface IScanOptions {
  /**
   * Measure the recursive size of artifact directories. This is by far the most
   * expensive part of a scan — a `node_modules` can hold a hundred thousand
   * files — so the caller can skip it when it only wants context and docs.
   */
  readonly measureArtifacts: boolean
  readonly signal?: AbortSignal
}

export async function scanRepository(
  repositoryId: number,
  repositoryPath: string,
  scannedAt: number,
  options: IScanOptions
): Promise<IRepositoryInventory> {
  try {
    const entry = await stat(repositoryPath)
    if (!entry.isDirectory()) {
      return emptyInventory(repositoryId, repositoryPath, scannedAt, {
        kind: 'missing',
      })
    }
  } catch {
    return emptyInventory(repositoryId, repositoryPath, scannedAt, {
      kind: 'missing',
    })
  }

  const contextFiles: Array<IContextFile> = []
  const docs: Array<IDocFile> = []
  const artifacts: Array<IArtifactDirectory> = []

  try {
    await walk(
      repositoryPath,
      '',
      0,
      contextFiles,
      docs,
      artifacts,
      repositoryPath,
      options
    )
  } catch (e) {
    if (options.signal?.aborted) {
      throw e
    }
    return {
      ...emptyInventory(repositoryId, repositoryPath, scannedAt, {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      }),
      contextFiles,
      docs,
      artifacts,
    }
  }

  return {
    repositoryId,
    repositoryPath,
    scannedAt,
    status: { kind: 'ok' },
    contextFiles: await resolveReferences(repositoryPath, contextFiles),
    docs,
    artifacts,
  }
}

async function walk(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  contextFiles: Array<IContextFile>,
  docs: Array<IDocFile>,
  artifacts: Array<IArtifactDirectory>,
  repositoryPath: string,
  options: IScanOptions
): Promise<void> {
  options.signal?.throwIfAborted()

  let entries
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    // An unreadable directory is not a reason to abandon the repository.
    return
  }

  const names = new Set(entries.map(e => e.name))
  const siblingExists = (name: string) => names.has(name)

  for (const entry of entries) {
    options.signal?.throwIfAborted()

    const relativePath =
      relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
    const absolutePath = Path.join(absoluteDir, entry.name)

    // Never follow symlinks. pnpm's node_modules is a forest of them, and a
    // cyclic link would otherwise walk until the stack gives out.
    if (entry.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      if (isNeverWalked(entry.name)) {
        continue
      }

      const artifactKind = classifyArtifact(entry.name, siblingExists)
      if (artifactKind !== null) {
        const measured = options.measureArtifacts
          ? await measureDirectory(absolutePath, options)
          : { byteLength: 0, fileCount: 0 }

        artifacts.push({
          kind: artifactKind,
          relativePath,
          byteLength: measured.byteLength,
          fileCount: measured.fileCount,
          modifiedAt: await modifiedTime(absolutePath),
        })

        // Deliberately do not descend. Nobody's agent context lives inside
        // node_modules, and pretending otherwise would make a scan cost minutes.
        continue
      }

      if (depth < MaxWalkDepth) {
        await walk(
          absolutePath,
          relativePath,
          depth + 1,
          contextFiles,
          docs,
          artifacts,
          repositoryPath,
          options
        )
      }
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const classification = classifyContext(relativePath)
    if (classification !== null) {
      const file = await readContextFile(
        absolutePath,
        relativePath,
        classification.agent,
        classification.role,
        ContextScope.Project
      )
      if (file !== null) {
        contextFiles.push(file)
      }
      continue
    }

    if (isDoc(relativePath)) {
      const doc = await readDocFile(absolutePath, relativePath)
      if (doc !== null) {
        docs.push(doc)
      }
    }
  }
}

async function readDocFile(
  absolutePath: string,
  relativePath: string
): Promise<IDocFile | null> {
  let info
  try {
    info = await lstat(absolutePath)
  } catch {
    return null
  }

  if (info.size > MaxParsedFileSize) {
    return {
      relativePath,
      title: null,
      byteLength: info.size,
      lineCount: 0,
      modifiedAt: info.mtimeMs,
    }
  }

  let content: string
  try {
    content = await readFile(absolutePath, 'utf8')
  } catch {
    return null
  }

  return {
    relativePath,
    title: parseTitle(content),
    byteLength: info.size,
    lineCount: countLines(content),
    modifiedAt: info.mtimeMs,
  }
}

interface IMeasurement {
  readonly byteLength: number
  readonly fileCount: number
}

/**
 * Recursive size of a directory. Symlinks are counted as neither their target's
 * size nor followed — a pnpm store would otherwise be counted once per package
 * that links to it, turning a 400 MB directory into 40 GB.
 */
async function measureDirectory(
  absoluteDir: string,
  options: IScanOptions
): Promise<IMeasurement> {
  options.signal?.throwIfAborted()

  let entries
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return { byteLength: 0, fileCount: 0 }
  }

  const nested = await Promise.all(
    entries.map(async (entry): Promise<IMeasurement> => {
      if (entry.isSymbolicLink()) {
        return { byteLength: 0, fileCount: 0 }
      }

      const absolutePath = Path.join(absoluteDir, entry.name)

      if (entry.isDirectory()) {
        return measureDirectory(absolutePath, options)
      }

      if (!entry.isFile()) {
        return { byteLength: 0, fileCount: 0 }
      }

      try {
        const info = await lstat(absolutePath)
        return { byteLength: info.size, fileCount: 1 }
      } catch {
        return { byteLength: 0, fileCount: 0 }
      }
    })
  )

  let byteLength = 0
  let fileCount = 0

  for (const measurement of nested) {
    byteLength += measurement.byteLength
    fileCount += measurement.fileCount
  }

  return { byteLength, fileCount }
}

async function modifiedTime(absolutePath: string): Promise<number> {
  try {
    const info = await lstat(absolutePath)
    return info.mtimeMs
  } catch {
    return 0
  }
}
