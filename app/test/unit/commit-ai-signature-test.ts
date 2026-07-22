import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CommitAuthorship,
  DefaultAIAuthorMarkers,
  IAIAuthorMarkers,
  ICoAuthor,
  classifyCommitAuthorship,
  lineAuthorships,
  parseCoAuthors,
} from '../../src/lib/diff/commit-ai-signature'

const claudeCoAuthor: ICoAuthor = {
  name: 'Claude',
  email: 'noreply@anthropic.com',
}

const human: ICoAuthor = { name: 'Ada Lovelace', email: 'ada@example.com' }

describe('parseCoAuthors', () => {
  it('returns nothing for a message with no trailers', () => {
    assert.deepStrictEqual(parseCoAuthors('Just a plain summary\n'), [])
  })

  it('returns nothing for an empty message', () => {
    assert.deepStrictEqual(parseCoAuthors(''), [])
  })

  it('parses a single co-author', () => {
    const message =
      'Fix a bug\n\nSome body text.\n\n' +
      'Co-Authored-By: Claude <noreply@anthropic.com>\n'

    assert.deepStrictEqual(parseCoAuthors(message), [claudeCoAuthor])
  })

  it('parses many co-authors in order', () => {
    const message =
      'Do a thing\n\n' +
      'Co-Authored-By: Ada Lovelace <ada@example.com>\n' +
      'Co-Authored-By: Claude <noreply@anthropic.com>\n'

    assert.deepStrictEqual(parseCoAuthors(message), [human, claudeCoAuthor])
  })

  it('matches the trailer key case-insensitively', () => {
    const message =
      'Summary\n\nco-AUTHORED-by: Claude <noreply@anthropic.com>\n'

    assert.deepStrictEqual(parseCoAuthors(message), [claudeCoAuthor])
  })

  it('tolerates surrounding whitespace and CRLF line endings', () => {
    const message =
      'Summary\r\n\r\n   Co-Authored-By:   Claude <noreply@anthropic.com>   \r\n'

    assert.deepStrictEqual(parseCoAuthors(message), [claudeCoAuthor])
  })

  it('ignores malformed trailer lines (no email angle brackets)', () => {
    const message =
      'Summary\n\n' +
      'Co-Authored-By: Claude noreply@anthropic.com\n' +
      'Co-Authored-By:\n' +
      'Co-Authored-By: Ada Lovelace <ada@example.com>\n'

    assert.deepStrictEqual(parseCoAuthors(message), [human])
  })

  it('does not match the phrase mid-sentence in prose', () => {
    const message =
      'This commit was co-authored-by nobody in particular really.\n'

    assert.deepStrictEqual(parseCoAuthors(message), [])
  })
})

describe('classifyCommitAuthorship', () => {
  it('classifies as ai when the author matches a marker', () => {
    const result = classifyCommitAuthorship(
      { author: claudeCoAuthor },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'ai')
  })

  it('classifies as ai when a co-author matches a marker', () => {
    const result = classifyCommitAuthorship(
      { author: human, coAuthors: [claudeCoAuthor] },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'ai')
  })

  it('classifies as ai when the committer matches a marker', () => {
    const result = classifyCommitAuthorship(
      { author: human, committer: claudeCoAuthor },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'ai')
  })

  it('classifies as human when nothing matches', () => {
    const result = classifyCommitAuthorship(
      { author: human, coAuthors: [{ name: 'Bob', email: 'bob@example.com' }] },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'human')
  })

  it('matches the default name marker case-insensitively and as a substring', () => {
    const result = classifyCommitAuthorship(
      {
        author: {
          name: 'CLAUDE Opus 4.8 (1M context)',
          email: 'someone@example.com',
        },
      },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'ai')
  })

  it('matches the default email marker case-insensitively', () => {
    const result = classifyCommitAuthorship(
      { author: { name: 'Anon', email: 'NoReply@Anthropic.Com' } },
      DefaultAIAuthorMarkers
    )
    assert.strictEqual(result, 'ai')
  })

  it('respects a custom marker set', () => {
    const markers: IAIAuthorMarkers = {
      names: [],
      emails: ['bot@my-agent.example'],
    }

    assert.strictEqual(
      classifyCommitAuthorship(
        { author: { name: 'My Agent', email: 'bot@my-agent.example' } },
        markers
      ),
      'ai'
    )

    // Claude is NOT in the custom set, so it is not classified as ai here.
    assert.strictEqual(
      classifyCommitAuthorship({ author: claudeCoAuthor }, markers),
      'human'
    )
  })

  it('defaults to human for an empty authorship input', () => {
    assert.strictEqual(
      classifyCommitAuthorship({}, DefaultAIAuthorMarkers),
      'human'
    )
  })
})

describe('lineAuthorships', () => {
  const authorshipByCommit = new Map<string, CommitAuthorship>([
    ['aaaaaaa', 'ai'],
    ['bbbbbbb', 'human'],
  ])

  it('maps ai, non-ai and uncommitted lines', () => {
    const perLineCommit = ['aaaaaaa', 'bbbbbbb', null]

    assert.deepStrictEqual(lineAuthorships(perLineCommit, authorshipByCommit), [
      'ai',
      'non-ai',
      'uncommitted',
    ])
  })

  it('treats an all-zero blame sha as uncommitted', () => {
    const perLineCommit = ['0000000000000000000000000000000000000000']

    assert.deepStrictEqual(lineAuthorships(perLineCommit, authorshipByCommit), [
      'uncommitted',
    ])
  })

  it('treats an unknown commit sha as uncommitted, never human', () => {
    const perLineCommit = ['ccccccc']

    assert.deepStrictEqual(lineAuthorships(perLineCommit, authorshipByCommit), [
      'uncommitted',
    ])
  })

  it('returns an empty array for no lines', () => {
    assert.deepStrictEqual(lineAuthorships([], authorshipByCommit), [])
  })
})
