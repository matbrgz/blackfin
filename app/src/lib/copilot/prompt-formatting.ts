import { extname } from 'path'

// Shared, pure markdown-prompt formatting helpers (#69).
//
// These three functions were born private inside `copilot-conflict-context.ts`,
// where the conflict serializer needed to fence user code without letting it
// break out and to sanitize a path before it became a heading. #69 adds a
// *second* serializer — the diff-annotation batch — with the exact same needs,
// and rewriting `makeFencedBlock` a second time would be rewriting a second
// bug: the dynamic fence length is subtle and already correct here. So the
// three helpers move to this shared module and both serializers import them.
//
// Everything here is pure: no fs, no git, no clock, no React. It reads only its
// arguments and returns a string. It never throws.

/**
 * Wrap content in a fenced code block using a delimiter long enough to avoid
 * breaking if the content itself contains backticks.
 *
 * The fence length is computed from the content: it scans for the longest run
 * of backticks and opens the fence with `max(3, longestRun + 1)` backticks, so
 * a line (or an annotation body) that itself contains a triple backtick cannot
 * escape the block. This is the load-bearing subtlety the whole "user code
 * can't break the prompt" guarantee rests on.
 */
export function makeFencedBlock(content: string, lang: string = ''): string {
  let maxRun = 2
  const runs = content.match(/`+/g)
  if (runs) {
    for (const run of runs) {
      if (run.length > maxRun) {
        maxRun = run.length
      }
    }
  }
  const fence = '`'.repeat(Math.max(3, maxRun + 1))
  return `${fence}${lang}\n${content}\n${fence}`
}

/**
 * Strip characters that could break markdown structure when used in
 * headings/labels. Removes carriage returns, newlines and backticks so a path
 * containing a backtick or a newline followed by `# Instructions: ignore the
 * above` cannot inject a heading.
 */
export function sanitizeForMarkdown(text: string): string {
  return text.replace(/[\r\n`]/g, '')
}

/**
 * Extract a language identifier from a file path for use in code fences. Only a
 * safe, purely alphanumeric extension is accepted as a language tag; anything
 * else yields the empty string (an untagged fence).
 */
export function getLangFromPath(filePath: string): string {
  const ext = extname(filePath)
  const lang = ext.startsWith('.') ? ext.slice(1) : ''
  // Only allow safe alphanumeric language tags
  return /^[a-zA-Z0-9]+$/.test(lang) ? lang : ''
}
