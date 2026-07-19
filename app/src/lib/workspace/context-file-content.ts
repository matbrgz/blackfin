import * as Path from 'path'

/**
 * Reading a context file back off disk so it can be shown in the in-app reader.
 *
 * `IContextFile` carries only metadata — the scan never keeps the raw bytes —
 * so opening one for reading means going back to the filesystem. The pieces
 * here are the pure decisions around that read (where the file is, whether its
 * bytes are text, how they split into lines); the actual I/O and the async
 * highlighting live in the reader component.
 */

/**
 * The most content we'll read into the reader. The same ceiling the diff
 * highlighter uses (`MaxHighlightContentLength`): a context file bigger than a
 * megabyte is not something anyone reads top to bottom, and tokenising it would
 * only make the modal janky.
 */
export const MaxReaderContentLength = 1024 * 1024

/**
 * Resolve a context file's path to an absolute one.
 *
 * A project file's `relativePath` is relative to the repository; a global one's
 * is relative to the home directory. Either way the base is a directory and the
 * relative path is what the scan recorded, so joining them is the whole job.
 * `Path.join` rather than string concatenation so a Windows path stays a
 * Windows path.
 */
export function contextFileAbsolutePath(
  basePath: string,
  relativePath: string
): string {
  return Path.join(basePath, relativePath)
}

/**
 * Whether a buffer looks like binary rather than text.
 *
 * A NUL byte is the cheap, reliable tell: text files effectively never contain
 * one, and virtually every binary format does within its first stretch. We only
 * look at a prefix because that's enough to decide and reading further would be
 * wasted work on a file we're about to refuse to render as text anyway.
 */
export function isProbablyBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8000)
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0) {
      return true
    }
  }
  return false
}

/**
 * Decode a text buffer into the lines the reader renders.
 *
 * CRLF and lone-LF both collapse to a single logical line break, so a file
 * authored on Windows lines up its gutter numbers the same as one authored on
 * Unix instead of showing a stray blank line after every row.
 */
export function decodeContentLines(buffer: Buffer): ReadonlyArray<string> {
  return buffer.toString('utf8').split(/\r?\n/)
}

/**
 * The line indices to ask the highlighter to tokenise: every line.
 *
 * The worker returns nothing for an empty filter (it's an optimisation the diff
 * relies on, where only the changed lines matter), but a whole-file reader
 * wants them all, so we hand it the full set.
 */
export function allLineIndices(lineCount: number): Array<number> {
  const indices = new Array<number>()
  for (let i = 0; i < lineCount; i++) {
    indices.push(i)
  }
  return indices
}
