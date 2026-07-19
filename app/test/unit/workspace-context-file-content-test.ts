import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  allLineIndices,
  contextFileAbsolutePath,
  decodeContentLines,
  isProbablyBinary,
} from '../../src/lib/workspace/context-file-content'

describe('contextFileAbsolutePath', () => {
  it('joins a repository path with a relative context path', () => {
    const base = Path.join('home', 'me', 'project')
    assert.equal(
      contextFileAbsolutePath(base, Path.join('.claude', 'CLAUDE.md')),
      Path.join(base, '.claude', 'CLAUDE.md')
    )
  })

  it('joins a home path with a global relative path', () => {
    const home = Path.join('home', 'me')
    assert.equal(
      contextFileAbsolutePath(home, Path.join('.claude', 'CLAUDE.md')),
      Path.join(home, '.claude', 'CLAUDE.md')
    )
  })

  it('normalises redundant separators via join', () => {
    const base = Path.join('a', 'b')
    assert.equal(contextFileAbsolutePath(base, 'c.md'), Path.join(base, 'c.md'))
  })
})

describe('isProbablyBinary', () => {
  it('treats a NUL byte as binary', () => {
    assert.equal(isProbablyBinary(Buffer.from([0x68, 0x00, 0x69])), true)
  })

  it('treats plain UTF-8 text as not binary', () => {
    assert.equal(
      isProbablyBinary(Buffer.from('# Title\nsome text', 'utf8')),
      false
    )
  })

  it('treats an empty buffer as not binary', () => {
    assert.equal(isProbablyBinary(Buffer.alloc(0)), false)
  })

  it('only samples the prefix', () => {
    const head = Buffer.alloc(8000, 0x61)
    const tail = Buffer.from([0x00])
    assert.equal(isProbablyBinary(Buffer.concat([head, tail])), false)
  })

  it('handles multibyte UTF-8 without false positives', () => {
    assert.equal(isProbablyBinary(Buffer.from('café — naïve ☃', 'utf8')), false)
  })
})

describe('decodeContentLines', () => {
  it('splits on LF', () => {
    assert.deepEqual(decodeContentLines(Buffer.from('a\nb\nc', 'utf8')), [
      'a',
      'b',
      'c',
    ])
  })

  it('normalises CRLF to a single break', () => {
    assert.deepEqual(decodeContentLines(Buffer.from('a\r\nb\r\nc', 'utf8')), [
      'a',
      'b',
      'c',
    ])
  })

  it('keeps a trailing newline as a final empty line', () => {
    assert.deepEqual(decodeContentLines(Buffer.from('a\n', 'utf8')), ['a', ''])
  })

  it('returns a single empty line for empty content', () => {
    assert.deepEqual(decodeContentLines(Buffer.alloc(0)), [''])
  })
})

describe('allLineIndices', () => {
  it('is empty for zero lines', () => {
    assert.deepEqual(allLineIndices(0), [])
  })

  it('lists every zero-based index', () => {
    assert.deepEqual(allLineIndices(3), [0, 1, 2])
  })
})
