import { randomBytes } from 'crypto'

import { DiffAnchorSide } from '../diff/diff-anchor'
import {
  getLangFromPath,
  makeFencedBlock,
  sanitizeForMarkdown,
} from './prompt-formatting'

// The pure core of the batched diff-annotation turn (#69).
//
// #68 lets a reviewer pin N notes to lines of a diff. This module is the second
// serializer the whole milestone pays off with: it takes those unresolved
// notes -- already resolved against the current diff, with the surrounding code
// already extracted by the caller -- and assembles them into ONE markdown
// document. One batch, one turn, one concentrated review. Sending the notes one
// at a time is not merely slower; it is worse, because each isolated turn sees
// only a fragment and the agent oscillates between fixing A and breaking B. The
// batch is the feature; everything else is UI.
//
// It is pure and total, exactly like the layout core in
// `lib/diff/diff-annotation.ts`: no fs, no git, no Dexie, no React, no clock,
// no network. It reads only its arguments and returns plain data, and it NEVER
// throws -- an empty set, an all-orphan set, a batch that blows every limit are
// ordinary *results*, not exceptions, because a review tool that crashes on odd
// input is a review tool that stops being trusted.
//
// Two disciplines are load-bearing here:
//   1. The line numbers emitted are FILE line numbers, from the anchor
//      resolution (#67) supplied by the caller -- never a render/diff index. A
//      unified-diff render index does not exist in the file the agent will open;
//      sending it would send a number that points at nothing.
//   2. The annotation body is UNTRUSTED. It is free user text concatenated into
//      an agent prompt, so it is always wrapped in per-request delimiters
//      generated with `randomBytes(8)` (the exact precedent is
//      `generateCommitMessagePromptTags` in `stores/copilot-store.ts`). A body
//      that contains the literal close tag cannot close the wrapper, because it
//      cannot predict the random token.

/**
 * One line of code context around an annotated line, extracted from the diff by
 * the caller (this module does no I/O). `isAnchor` marks the exact line the note
 * was pinned to.
 */
export interface IAnnotationContextLine {
  /** File line number (from anchor resolution, #67). A real file line. */
  readonly lineNumber: number
  readonly content: string
  readonly isAnchor: boolean
}

/**
 * One candidate annotation to consider for the batch, already resolved against
 * the current diff by the caller.
 *
 * `lineNumber` is `null` for an ORPHAN -- a note whose anchored line no longer
 * exists in the diff. Orphans are excluded from the batch (there is nothing in
 * the file for the agent to fix) and counted, never silently dropped.
 */
export interface IAnnotationCandidate {
  readonly path: string
  /**
   * File line number of the anchored line, from anchor resolution (#67), or
   * `null` when the annotation is orphaned. A real file line, never a render
   * index.
   */
  readonly lineNumber: number | null
  readonly side: DiffAnchorSide
  /** Surrounding code, extracted from the diff by the caller. Pure input. */
  readonly contextLines: ReadonlyArray<IAnnotationContextLine>
  /** The note body, written by the user. UNTRUSTED -- wrapped in a delimiter. */
  readonly body: string
}

/** A single annotation placed in the batch, with a concrete file line number. */
export interface IAnnotationPromptEntry {
  /** File line number (from anchor resolution). A real file line. */
  readonly lineNumber: number
  readonly side: DiffAnchorSide
  readonly contextLines: ReadonlyArray<IAnnotationContextLine>
  /** UNTRUSTED user body -- wrapped in a per-request delimiter when serialized. */
  readonly body: string
}

/** One file's worth of batched annotations, entries ordered by line number. */
export interface IAnnotationPromptFile {
  readonly path: string
  readonly entries: ReadonlyArray<IAnnotationPromptEntry>
}

/**
 * The assembled batch: the files that made it in, plus the counts the
 * confirmation dialog MUST show. No cut is silent -- an excluded orphan and a
 * limit-truncated note are both reported here.
 */
export interface IAnnotationBatchContext {
  readonly files: ReadonlyArray<IAnnotationPromptFile>
  /** Orphaned annotations excluded from the batch (their line is gone). */
  readonly excludedOrphanCount: number
  /** Annotations dropped to satisfy a hard limit (count or prompt size). */
  readonly truncatedCount: number
}

/**
 * Fresh per-request delimiters that wrap each untrusted annotation body -- the
 * content cannot predict the random token, so it cannot close the tag. Modelled
 * on `generateCommitMessagePromptTags` (`stores/copilot-store.ts`).
 */
export interface IAnnotationPromptTags {
  readonly annotationOpen: string
  readonly annotationClose: string
}

/** The hard limits enforced when assembling a batch. */
export interface IAnnotationBatchLimits {
  /** Ceiling on annotations in one batch; the rest are truncated and reported. */
  readonly maxAnnotationsPerBatch: number
  /** Ceiling on the total prompt length in characters. */
  readonly maxPromptChars: number
}

/**
 * The result of assembling a batch. `prompt` is `''` when the batch is empty
 * (no non-orphan annotations, or everything truncated away): callers treat an
 * empty prompt as "nothing to send", never as an error.
 */
export interface IAnnotationBatchResult {
  /** The single markdown document, or `''` when there is nothing to send. */
  readonly prompt: string
  /** The context actually serialized, with the reported exclusion/truncation. */
  readonly context: IAnnotationBatchContext
  /** True when no annotation made it into the prompt. */
  readonly isEmpty: boolean
}

/** Ceiling on annotations in a single batch. */
export const MaxAnnotationsPerBatch = 25

/** Lines of context to extract on each side of an annotated line (caller budget). */
export const ContextLinesPerAnnotation = 3

/** Ceiling on the total prompt length, in characters. */
export const MaxPromptChars = 200_000

/** The default hard limits, in the spirit of the existing prompt-size caps. */
export const DefaultAnnotationBatchLimits: IAnnotationBatchLimits = {
  maxAnnotationsPerBatch: MaxAnnotationsPerBatch,
  maxPromptChars: MaxPromptChars,
}

/**
 * Generate fresh per-request annotation delimiters. Impure (reads the CSPRNG),
 * so the serializer takes the tags as an argument and stays pure/deterministic;
 * the caller mints one set per turn. Exported for the deferred store driver and
 * for tests.
 */
export function generateAnnotationPromptTags(): IAnnotationPromptTags {
  const token = randomBytes(8).toString('hex')
  return {
    annotationOpen: `<annot-${token}>`,
    annotationClose: `</annot-${token}>`,
  }
}

/**
 * The pt-BR side label the agent reads: which side of the diff the line lives on.
 */
function sideLabel(side: DiffAnchorSide): string {
  return side === 'new' ? 'novo' : 'antigo'
}

/**
 * A stable dedup/ordering key for a candidate: same path + line + side + body is
 * the same note twice. `JSON.stringify` of the tuple gives an unambiguous key
 * with no hand-rolled separator that a body could spoof.
 */
function candidateKey(c: {
  readonly path: string
  readonly lineNumber: number
  readonly side: DiffAnchorSide
  readonly body: string
}): string {
  return JSON.stringify([c.path, c.lineNumber, c.side, c.body])
}

/**
 * Assemble unresolved, diff-resolved candidate annotations into a single batch:
 * exclude and count orphans, dedup exact duplicates, group by file and order by
 * line, and enforce the annotation-count limit. Pure and total.
 *
 * Files are ordered by path and entries by line number (ties broken by side then
 * body) so the same inputs always yield the same batch. The prompt-size limit is
 * NOT applied here -- it needs the serialized length and is handled in
 * {@link assembleAnnotationBatch}.
 */
export function buildAnnotationBatchContext(
  candidates: ReadonlyArray<IAnnotationCandidate>,
  limits: IAnnotationBatchLimits = DefaultAnnotationBatchLimits
): IAnnotationBatchContext {
  let excludedOrphanCount = 0
  const seen = new Set<string>()

  // Flatten to non-orphan, de-duplicated entries carrying their path.
  const flat: Array<{
    readonly path: string
    readonly entry: IAnnotationPromptEntry
  }> = []

  for (const c of candidates) {
    if (c.lineNumber === null) {
      excludedOrphanCount++
      continue
    }

    const key = candidateKey({
      path: c.path,
      lineNumber: c.lineNumber,
      side: c.side,
      body: c.body,
    })
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    flat.push({
      path: c.path,
      entry: {
        lineNumber: c.lineNumber,
        side: c.side,
        contextLines: c.contextLines,
        body: c.body,
      },
    })
  }

  // Global deterministic order: by path, then line, then side, then body.
  flat.sort((a, b) => {
    if (a.path !== b.path) {
      return a.path < b.path ? -1 : 1
    }
    if (a.entry.lineNumber !== b.entry.lineNumber) {
      return a.entry.lineNumber - b.entry.lineNumber
    }
    if (a.entry.side !== b.entry.side) {
      return a.entry.side < b.entry.side ? -1 : 1
    }
    if (a.entry.body !== b.entry.body) {
      return a.entry.body < b.entry.body ? -1 : 1
    }
    return 0
  })

  const cap = Math.max(0, limits.maxAnnotationsPerBatch)
  const kept = flat.slice(0, cap)
  const truncatedCount = flat.length - kept.length

  return {
    files: groupIntoFiles(kept),
    excludedOrphanCount,
    truncatedCount,
  }
}

/** Group an already-ordered flat list into files, preserving entry order. */
function groupIntoFiles(
  flat: ReadonlyArray<{
    readonly path: string
    readonly entry: IAnnotationPromptEntry
  }>
): ReadonlyArray<IAnnotationPromptFile> {
  const files: Array<{ path: string; entries: Array<IAnnotationPromptEntry> }> =
    []
  let current: { path: string; entries: Array<IAnnotationPromptEntry> } | null =
    null

  for (const item of flat) {
    if (current === null || current.path !== item.path) {
      current = { path: item.path, entries: [] }
      files.push(current)
    }
    current.entries.push(item.entry)
  }

  return files
}

/** Total entries across all files of a batch context. */
function countEntries(context: IAnnotationBatchContext): number {
  let total = 0
  for (const file of context.files) {
    total += file.entries.length
  }
  return total
}

/**
 * Render a single annotation's code context as fenced-block body lines. The
 * anchored line is prefixed with `>>>`, so the agent sees exactly which line the
 * note is about. The whole block is later fenced via {@link makeFencedBlock}, so
 * a context line containing a triple backtick cannot escape it.
 */
function formatContextLines(
  contextLines: ReadonlyArray<IAnnotationContextLine>
): string {
  const rendered = contextLines.map(line => {
    const marker = line.isAnchor ? ' >>>' : ''
    return `${line.lineNumber} |${marker} ${line.content}`
  })
  return rendered.join('\n')
}

/**
 * Serialize an assembled batch into ONE markdown document. Pure: takes the
 * already-built context and the per-request delimiter tags, returns a string,
 * never throws. Returns `''` when the batch has no files.
 *
 * This is the function the acceptance criteria name. Every code block goes
 * through {@link makeFencedBlock} (dynamic fence length), every path through
 * {@link sanitizeForMarkdown}, and every untrusted body is wrapped in `tags`.
 */
export function formatAnnotationsForPrompt(
  context: IAnnotationBatchContext,
  tags: IAnnotationPromptTags
): string {
  const totalEntries = countEntries(context)
  if (totalEntries === 0) {
    return ''
  }

  const fileCount = context.files.length
  const parts: Array<string> = []

  parts.push(
    `# Revisão de código: ${totalEntries} comentários não resolvidos em ${fileCount} arquivos`
  )
  parts.push('')
  parts.push(
    'Um revisor humano marcou as linhas abaixo no diff do seu trabalho.'
  )
  parts.push(
    'Trate cada comentário como uma correção pedida. Resolva TODOS de uma vez --'
  )
  parts.push(
    'não conserte um de cada vez; correções isoladas tendem a desfazer umas às outras.'
  )
  parts.push('')

  for (const file of context.files) {
    const safePath = sanitizeForMarkdown(file.path)
    const lang = getLangFromPath(file.path)

    parts.push(`## Arquivo: ${safePath}`)
    parts.push('')

    const n = file.entries.length
    for (let i = 0; i < n; i++) {
      const entry = file.entries[i]

      parts.push(
        `### Comentário ${i + 1} de ${n} — linha ${
          entry.lineNumber
        } (${sideLabel(entry.side)})`
      )
      parts.push('')

      parts.push('Código:')
      parts.push(makeFencedBlock(formatContextLines(entry.contextLines), lang))
      parts.push('')

      parts.push('Comentário do revisor:')
      parts.push(tags.annotationOpen)
      parts.push(entry.body)
      parts.push(tags.annotationClose)
      parts.push('')
    }
  }

  return parts.join('\n')
}

/**
 * The whole pipeline: build the batch (exclude orphans, dedup, order, apply the
 * count limit), serialize it, and enforce the prompt-size limit by dropping
 * trailing annotations and RE-serializing -- never by slicing the string, so the
 * prompt is always well-formed markdown. Every drop is reported in
 * `context.truncatedCount`. Pure and total; returns a result, never throws.
 */
export function assembleAnnotationBatch(
  candidates: ReadonlyArray<IAnnotationCandidate>,
  tags: IAnnotationPromptTags,
  limits: IAnnotationBatchLimits = DefaultAnnotationBatchLimits
): IAnnotationBatchResult {
  let context = buildAnnotationBatchContext(candidates, limits)
  let prompt = formatAnnotationsForPrompt(context, tags)

  // Shed the last annotation and re-serialize until the prompt fits. Structured
  // truncation keeps the markdown valid at every step; a naive string slice
  // could cut a fence in half and hand the agent a malformed prompt.
  const maxChars = Math.max(0, limits.maxPromptChars)
  while (prompt.length > maxChars && countEntries(context) > 0) {
    context = dropLastEntry(context)
    prompt = formatAnnotationsForPrompt(context, tags)
  }

  const isEmpty = countEntries(context) === 0
  return { prompt: isEmpty ? '' : prompt, context, isEmpty }
}

/** Remove the final entry (last file's last entry), bumping `truncatedCount`. */
function dropLastEntry(
  context: IAnnotationBatchContext
): IAnnotationBatchContext {
  const files = context.files.map(f => ({
    path: f.path,
    entries: [...f.entries],
  }))
  for (let i = files.length - 1; i >= 0; i--) {
    if (files[i].entries.length > 0) {
      files[i].entries.pop()
      break
    }
  }
  const kept = files.filter(f => f.entries.length > 0)
  return {
    files: kept,
    excludedOrphanCount: context.excludedOrphanCount,
    truncatedCount: context.truncatedCount + 1,
  }
}
