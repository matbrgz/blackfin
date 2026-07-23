import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IBlameLineCommit,
  parseBlamePorcelain,
} from '../../src/lib/git/blame-authorship'

const AI_SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const HUMAN_SHA = 'b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1'
const ZERO_SHA = '0000000000000000000000000000000000000000'

/**
 * Build a `git blame --porcelain` fixture from an array of records, joined by
 * real newlines. Content lines must already carry their leading '\t'. We build
 * with '\n'/'\t' escapes only — never raw control/NUL bytes.
 */
function porcelain(records: ReadonlyArray<string>): string {
  return records.join('\n') + '\n'
}

// Two AI lines (a group of 2), one human line, one uncommitted (boundary) line.
const representativeBlame = porcelain([
  `${AI_SHA} 1 1 2`,
  'author Claude',
  'author-mail <noreply@anthropic.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Claude',
  'committer-mail <noreply@anthropic.com>',
  'committer-time 1700000000',
  'committer-tz +0000',
  'summary Let an AI write this',
  'filename foo.ts',
  '\tconst a = 1',
  `${AI_SHA} 2 2`,
  '\tconst b = 2',
  `${HUMAN_SHA} 5 3 1`,
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1700000100',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-mail <ada@example.com>',
  'committer-time 1700000100',
  'committer-tz +0000',
  'summary A human wrote this',
  'filename foo.ts',
  '\tconst c = 3',
  `${ZERO_SHA} 4 4 1`,
  'author Not Committed Yet',
  'author-mail <not.committed.yet>',
  'author-time 1700000200',
  'author-tz +0000',
  'summary Version of foo.ts from foo.ts',
  'filename foo.ts',
  '\tconst d = 4',
])

describe('parseBlamePorcelain', () => {
  it('returns empty structures for empty input', () => {
    const parsed = parseBlamePorcelain('')
    assert.deepStrictEqual(parsed.lineCommits, [])
    assert.strictEqual(parsed.commits.size, 0)
  })

  it('maps each final line number to its introducing sha', () => {
    const { lineCommits } = parseBlamePorcelain(representativeBlame)

    const expected: ReadonlyArray<IBlameLineCommit> = [
      { line: 1, sha: AI_SHA },
      { line: 2, sha: AI_SHA },
      { line: 3, sha: HUMAN_SHA },
      { line: 4, sha: null },
    ]

    assert.deepStrictEqual(lineCommits, expected)
  })

  it('records the boundary (all-zero) sha as null, not as a commit', () => {
    const { lineCommits, commits } = parseBlamePorcelain(representativeBlame)

    const uncommitted = lineCommits.find(entry => entry.line === 4)
    assert.strictEqual(uncommitted?.sha, null)
    assert.strictEqual(commits.has(ZERO_SHA), false)
  })

  it('extracts author name, email (angle brackets stripped) and summary per sha', () => {
    const { commits } = parseBlamePorcelain(representativeBlame)

    assert.deepStrictEqual(commits.get(AI_SHA), {
      sha: AI_SHA,
      author: { name: 'Claude', email: 'noreply@anthropic.com' },
      summary: 'Let an AI write this',
    })

    assert.deepStrictEqual(commits.get(HUMAN_SHA), {
      sha: HUMAN_SHA,
      author: { name: 'Ada Lovelace', email: 'ada@example.com' },
      summary: 'A human wrote this',
    })
  })

  it('only records the extended block the first time a sha appears', () => {
    const { commits } = parseBlamePorcelain(representativeBlame)
    // The AI sha appears twice (lines 1 and 2) but yields exactly one entry.
    assert.strictEqual(commits.size, 2)
  })

  it('normalizes CRLF line endings', () => {
    const crlf = representativeBlame.replace(/\n/g, '\r\n')
    const { lineCommits, commits } = parseBlamePorcelain(crlf)

    assert.deepStrictEqual(
      lineCommits.map(entry => entry.sha),
      [AI_SHA, AI_SHA, HUMAN_SHA, null]
    )
    assert.strictEqual(
      commits.get(AI_SHA)?.author?.email,
      'noreply@anthropic.com'
    )
    assert.strictEqual(commits.get(AI_SHA)?.summary, 'Let an AI write this')
  })

  it('never throws on malformed / truncated input', () => {
    const garbage = porcelain([
      'not a header at all',
      '\torphan content line',
      `${AI_SHA} 1`,
      'author-mail <no-closing-header',
    ])
    assert.doesNotThrow(() => parseBlamePorcelain(garbage))
  })
})
