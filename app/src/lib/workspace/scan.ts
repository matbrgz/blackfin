import { readdir, readFile, lstat, stat } from 'fs/promises'
import * as Path from 'path'
import {
  AgentId,
  ContextRole,
  IArtifactDirectory,
  IContextFile,
  IContextReference,
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
  countLines,
  countRules,
  extractReferences,
  parseFrontmatter,
  parseHeadings,
  parseTitle,
} from './parse'

/**
 * Scanning a repository: the I/O boundary. Everything interesting is in
 * `catalog.ts` and `parse.ts`, which are pure. This file walks a disk and
 * refuses to throw while doing it.
 */

/**
 * Files above this are reported with their size but not parsed. The same limit
 * the Copilot conflict context uses (`copilot-conflict-context.ts`), for the
 * same reason: nobody's CLAUDE.md is a megabyte, and if one is, reading it into
 * memory to count its bullet points is not a service to anyone.
 */
const MaxParsedFileSize = 1024 * 1024

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

  const resolved = await resolveReferences(repositoryPath, contextFiles)

  return {
    repositoryId,
    repositoryPath,
    scannedAt,
    status: { kind: 'ok' },
    contextFiles: resolved,
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
        const modifiedAt = await modifiedTime(absolutePath)
        artifacts.push({
          kind: artifactKind,
          relativePath,
          byteLength: measured.byteLength,
          fileCount: measured.fileCount,
          modifiedAt,
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
        classification.role
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

async function readContextFile(
  absolutePath: string,
  relativePath: string,
  agent: AgentId,
  role: ContextRole
): Promise<IContextFile | null> {
  let info
  try {
    info = await lstat(absolutePath)
  } catch {
    return null
  }

  const base = {
    agent,
    role,
    relativePath,
    byteLength: info.size,
    modifiedAt: info.mtimeMs,
  }

  if (info.size > MaxParsedFileSize) {
    return {
      ...base,
      lineCount: 0,
      name: null,
      description: null,
      headings: [],
      ruleCount: 0,
      references: [],
      skippedReason: 'File exceeds the 1 MB parse limit',
    }
  }

  let content: string
  try {
    content = await readFile(absolutePath, 'utf8')
  } catch {
    return {
      ...base,
      lineCount: 0,
      name: null,
      description: null,
      headings: [],
      ruleCount: 0,
      references: [],
      skippedReason: 'File could not be read',
    }
  }

  const frontmatter = parseFrontmatter(content)

  return {
    ...base,
    lineCount: countLines(content),
    name: frontmatter.name,
    description: frontmatter.description,
    headings: parseHeadings(content),
    ruleCount: countRules(content),
    // Resolved against the filesystem in a second pass, once the walk is done.
    references: extractReferences(content).map(target => ({
      raw: target,
      target,
      exists: false,
    })),
    skippedReason: null,
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

/**
 * Resolve every reference against the filesystem, so that a context file
 * pointing at a document somebody deleted shows up as pointing at nothing.
 *
 * References are relative to the directory of the file that made them, which is
 * what both Claude's `@import` and a markdown link mean.
 */
async function resolveReferences(
  repositoryPath: string,
  files: ReadonlyArray<IContextFile>
): Promise<ReadonlyArray<IContextFile>> {
  const cache = new Map<string, Promise<boolean>>()

  const existsCached = (absolutePath: string): Promise<boolean> => {
    const hit = cache.get(absolutePath)
    if (hit !== undefined) {
      return hit
    }
    const promise = lstat(absolutePath).then(
      () => true,
      () => false
    )
    cache.set(absolutePath, promise)
    return promise
  }

  return Promise.all(
    files.map(async file => {
      if (file.references.length === 0) {
        return file
      }

      const fileDir = Path.dirname(Path.join(repositoryPath, file.relativePath))

      const references = await Promise.all(
        file.references.map(async (reference): Promise<IContextReference> => {
          const absolutePath = Path.resolve(fileDir, reference.target)

          // A reference that escapes the repository is not one we resolve. It
          // isn't necessarily broken — it just isn't ours to judge.
          const relative = Path.relative(repositoryPath, absolutePath)
          if (relative.startsWith('..') || Path.isAbsolute(relative)) {
            return { ...reference, exists: true }
          }

          return { ...reference, exists: await existsCached(absolutePath) }
        })
      )

      return { ...file, references }
    })
  )
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

  let byteLength = 0
  let fileCount = 0

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
