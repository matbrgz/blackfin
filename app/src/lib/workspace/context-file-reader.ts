import { readFile, lstat } from 'fs/promises'
import * as Path from 'path'
import {
  AgentId,
  ContextRole,
  ContextScope,
  IContextFile,
  IContextReference,
} from '../../models/workspace-inventory'
import {
  countLines,
  countRules,
  extractReferences,
  parseFrontmatter,
  parseHeadings,
} from './parse'

/**
 * Reading one agent-context file off disk and turning it into an
 * `IContextFile`. Shared by the repository scan and the global scan, which
 * differ only in where they look and what scope they stamp on the result.
 *
 * Nothing here throws. A file that cannot be read becomes a file with a
 * `skippedReason`, because a scan that aborts because one repository has an
 * unreadable `.cursorrules` is worse than useless.
 */

/**
 * Files above this are reported with their size but not parsed. The same limit
 * the Copilot conflict context uses, for the same reason: nobody's CLAUDE.md is
 * a megabyte, and if one is, reading it into memory to count its bullet points
 * is not a service to anyone.
 */
export const MaxParsedFileSize = 1024 * 1024

export async function readContextFile(
  absolutePath: string,
  relativePath: string,
  agent: AgentId,
  role: ContextRole,
  scope: ContextScope
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
    scope,
    relativePath,
    byteLength: info.size,
    modifiedAt: info.mtimeMs,
  }

  const unparsed = (skippedReason: string): IContextFile => ({
    ...base,
    lineCount: 0,
    name: null,
    description: null,
    headings: [],
    ruleCount: 0,
    references: [],
    skippedReason,
  })

  if (info.size > MaxParsedFileSize) {
    return unparsed('File exceeds the 1 MB parse limit')
  }

  let content: string
  try {
    content = await readFile(absolutePath, 'utf8')
  } catch {
    return unparsed('File could not be read')
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

/**
 * Resolve every reference against the filesystem, so that a context file
 * pointing at a document somebody deleted shows up as pointing at nothing. This
 * is the single most useful signal the whole feature produces.
 *
 * References are relative to the directory of the file that made them, which is
 * what both Claude's `@import` and a markdown link mean.
 *
 * A reference that escapes the root is reported as existing rather than broken.
 * It isn't necessarily broken — it just isn't ours to judge.
 */
export async function resolveReferences(
  rootPath: string,
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

      const fileDir = Path.dirname(Path.join(rootPath, file.relativePath))

      const references = await Promise.all(
        file.references.map(async (reference): Promise<IContextReference> => {
          const absolutePath = Path.resolve(fileDir, reference.target)
          const relative = Path.relative(rootPath, absolutePath)

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
