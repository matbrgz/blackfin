import { IHeading } from '../../models/workspace-inventory'

/**
 * Parsing of context and documentation files. Every function here is pure and
 * takes content as a string, so the whole of the interesting logic can be
 * tested without a filesystem.
 *
 * None of these throw. A malformed file yields fewer extracted fields, never an
 * exception — a scan that aborts because one repository has a weird
 * `.cursorrules` is worse than useless.
 */

export interface IFrontmatter {
  readonly name: string | null
  readonly description: string | null
}

const FrontmatterDelimiter = /^---\s*$/

/**
 * Read the YAML frontmatter block, if there is one, extracting just the two
 * keys we care about. This is not a YAML parser and does not pretend to be: it
 * reads `key: value` at the top level, which is all a skill or command manifest
 * uses for these fields.
 *
 * An unterminated frontmatter block yields nothing rather than swallowing the
 * whole file.
 */
export function parseFrontmatter(content: string): IFrontmatter {
  const empty = { name: null, description: null }
  const lines = content.split('\n')

  if (lines.length === 0 || !FrontmatterDelimiter.test(lines[0])) {
    return empty
  }

  const end = lines.findIndex((line, i) => i > 0 && FrontmatterDelimiter.test(line))
  if (end === -1) {
    return empty
  }

  let name: string | null = null
  let description: string | null = null

  for (const line of lines.slice(1, end)) {
    // Only top-level keys. An indented line is a value belonging to a key we
    // don't read.
    if (/^\s/.test(line)) {
      continue
    }
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (match === null) {
      continue
    }
    const value = unquote(match[2].trim())
    if (value.length === 0) {
      continue
    }
    if (match[1] === 'name') {
      name = value
    } else if (match[1] === 'description') {
      description = value
    }
  }

  return { name, description }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * Strip fenced code blocks, replacing each line with an empty one so that line
 * counts and ordering are preserved. Without this, a `# comment` inside a shell
 * snippet reads as a heading and a `- item` inside a diff reads as a rule.
 */
function blankOutCodeFences(lines: ReadonlyArray<string>): Array<string> {
  const out: Array<string> = []
  let fence: string | null = null

  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)

    if (fence === null) {
      if (match !== null) {
        fence = match[1][0].repeat(match[1].length)
        out.push('')
        continue
      }
      out.push(line)
      continue
    }

    // Inside a fence. It closes on a delimiter of the same character that is at
    // least as long as the one that opened it.
    if (match !== null && match[1][0] === fence[0] && match[1].length >= fence.length) {
      fence = null
    }
    out.push('')
  }

  return out
}

/** Content lines with fenced code blocks blanked out. */
function contentLines(content: string): Array<string> {
  return blankOutCodeFences(content.split('\n'))
}

export function parseHeadings(content: string): ReadonlyArray<IHeading> {
  const headings: Array<IHeading> = []

  for (const line of contentLines(content)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match !== null) {
      headings.push({ level: match[1].length, text: match[2] })
    }
  }

  return headings
}

/** The first level-1 heading, which is a document's title by convention. */
export function parseTitle(content: string): string | null {
  const headings = parseHeadings(content)
  return headings.find(h => h.level === 1)?.text ?? headings[0]?.text ?? null
}

/**
 * How many rules a context file states. A proxy, not a measurement: bullet
 * points and numbered items are how instructions are almost always written, and
 * counting them tells you whether a file says three things or three hundred.
 */
export function countRules(content: string): number {
  let count = 0

  for (const line of contentLines(content)) {
    if (/^\s*([-*+]|\d+\.)\s+\S/.test(line)) {
      count++
    }
  }

  return count
}

/**
 * Paths a context file points at: Claude-style `@imports` and relative markdown
 * links. Absolute URLs are not references — they can't be broken in a way we
 * could detect, and reporting them as unresolvable would be noise.
 */
export function extractReferences(content: string): ReadonlyArray<string> {
  const found = new Set<string>()

  for (const line of contentLines(content)) {
    for (const match of line.matchAll(/(^|\s)@([^\s`'"]+)/g)) {
      // An import at the end of a sentence carries the sentence's punctuation
      // with it. `@docs/spec.md.` is a reference to `docs/spec.md`, and taking
      // the trailing period literally would report every such reference as
      // broken.
      const target = trimTrailingPunctuation(stripAnchor(match[2]))
      if (looksLikePath(target)) {
        found.add(target)
      }
    }

    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = stripAnchor(match[1])
      if (looksLikePath(target)) {
        found.add(target)
      }
    }
  }

  return [...found]
}

function trimTrailingPunctuation(target: string): string {
  return target.replace(/[.,;:!?)\]}'"]+$/, '')
}

function stripAnchor(target: string): string {
  const hash = target.indexOf('#')
  return hash === -1 ? target : target.slice(0, hash)
}

function looksLikePath(target: string): boolean {
  if (target.length === 0) {
    return false
  }
  // Not a URL, a protocol-relative URL, a bare fragment, or an absolute path.
  if (/^[a-zA-Z][\w+.-]*:/.test(target) || target.startsWith('//')) {
    return false
  }
  if (target.startsWith('#') || target.startsWith('/')) {
    return false
  }
  // An `@mention` of a person is not a path. Requiring a separator or an
  // extension is a heuristic, but it's the one that keeps `@claude` out.
  return target.includes('/') || /\.\w+$/.test(target)
}

export function countLines(content: string): number {
  if (content.length === 0) {
    return 0
  }
  const lines = content.split('\n')
  // A trailing newline terminates the last line rather than starting a new one.
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}
