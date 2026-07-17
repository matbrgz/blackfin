import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  normalizeCheckpoint,
  MaxCheckpointLength,
  CheckpointStatusLanes,
  isCheckpointStatusLane,
} from '../../src/lib/cli/checkpoint'
import { resolveCommand, allCommands } from '../../src/lib/cli/registry'

// The family ZWJ emoji: four people joined by U+200D — a single grapheme.
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'

describe('normalizeCheckpoint', () => {
  it('folds every line break into a single line', () => {
    assert.strictEqual(normalizeCheckpoint('a\nb\nc').text, 'a b c')
    assert.strictEqual(normalizeCheckpoint('a\r\nb').text, 'a b')
    assert.strictEqual(normalizeCheckpoint('a b c').text, 'a b c')
  })

  it('truncates past the cap by grapheme, flags it, and warns exactly once', () => {
    const result = normalizeCheckpoint('a'.repeat(400))
    assert.strictEqual(Array.from(result.text).length, MaxCheckpointLength)
    assert.strictEqual(result.truncated, true)
    assert.strictEqual(result.warnings.length, 1)
  })

  it('never splits a composed emoji at the truncation boundary', () => {
    // 279 filler graphemes, then the family emoji as the 280th. It must survive
    // whole; the trailing 'tail' is past the cap and must be dropped entirely.
    const raw = 'a'.repeat(279) + FAMILY + 'tail'
    const result = normalizeCheckpoint(raw)
    assert.strictEqual(result.truncated, true)
    assert.ok(
      result.text.endsWith(FAMILY),
      'the composed emoji must be kept whole, never cut mid-cluster'
    )
    assert.ok(!result.text.includes('tail'))
  })

  it('never splits a base character from its combining mark', () => {
    // 279 filler + base 'e' with a combining acute (U+0301) as the 280th
    // grapheme. It must survive whole; after NFC the pair composes to 'é'.
    const raw = 'a'.repeat(279) + 'é' + 'x'
    const result = normalizeCheckpoint(raw)
    assert.strictEqual(result.truncated, true)
    assert.ok(result.text.endsWith('é'))
  })

  it('strips a whole OSC escape sequence, leaving no escape byte behind', () => {
    const result = normalizeCheckpoint('\x1b]0;pwned\x07ok')
    assert.strictEqual(result.text, 'ok')
    assert.doesNotMatch(result.text, /[\x00-\x1f\x7f]/)
  })

  it('strips a CSI color escape sequence', () => {
    assert.strictEqual(normalizeCheckpoint('\x1b[31mred\x1b[0m').text, 'red')
  })

  it('removes a bidi override', () => {
    const result = normalizeCheckpoint('a‮b')
    assert.strictEqual(result.text, 'ab')
  })

  it('rejects empty and whitespace-only input by returning an empty string', () => {
    assert.strictEqual(normalizeCheckpoint('').text, '')
    assert.strictEqual(normalizeCheckpoint('   ').text, '')
    assert.strictEqual(normalizeCheckpoint('\n\t  \r\n').text, '')
  })

  it('normalizes to NFC so equivalent representations collapse to one value', () => {
    const composed = normalizeCheckpoint('é').text // é precomposed
    const decomposed = normalizeCheckpoint('é').text // e + acute
    assert.strictEqual(composed, decomposed)
    assert.strictEqual(composed, 'é')
  })

  it('passes an already-clean line through byte-for-byte', () => {
    const clean =
      'Auth migration done. 3 tests still failing in session-store, mock clock off.'
    const result = normalizeCheckpoint(clean)
    assert.strictEqual(result.text, clean)
    assert.strictEqual(result.truncated, false)
    assert.strictEqual(result.warnings.length, 0)
  })

  it('never throws, for any input', () => {
    for (const raw of ['', '   ', '\x1b]0;x', 'x'.repeat(5000), FAMILY]) {
      assert.doesNotThrow(() => normalizeCheckpoint(raw))
    }
  })
})

describe('checkpoint status lanes', () => {
  it('recognizes exactly the known lanes', () => {
    for (const lane of CheckpointStatusLanes) {
      assert.ok(isCheckpointStatusLane(lane))
    }
    assert.ok(!isCheckpointStatusLane('shipped'))
    assert.ok(!isCheckpointStatusLane(''))
  })
})

describe('checkpoint command descriptors', () => {
  const knownRepo = {
    name: 'proj',
    gitDir: '/Users/x/proj/.git',
    worktree: '/Users/x/proj/wt-a',
  }
  const app = { name: 'Blackfin', appVersion: '1.0.0', pid: 1 }

  it('registers both checkpoint commands', () => {
    assert.ok(resolveCommand('checkpoint set') !== null)
    assert.ok(resolveCommand('checkpoint get') !== null)
  })

  it('checkpoint set mutates, writes metadata, and justifies no-confirmation', () => {
    const set = resolveCommand('checkpoint set')
    assert.ok(set !== null)
    assert.strictEqual(set?.mutates, true)
    assert.strictEqual(set?.confirmation, 'none')
    assert.deepStrictEqual(set?.effects, ['writes-blackfin-metadata'])
    // The rule from #62: a mutating, non-confirming command must justify itself.
    assert.ok((set?.guardrails.length ?? 0) > 0)
    assert.ok(
      set?.guardrails.some(g => /secret/i.test(g)),
      'must warn against putting secrets in a checkpoint'
    )
  })

  it('checkpoint get is a read-only query', () => {
    const get = resolveCommand('checkpoint get')
    assert.ok(get !== null)
    assert.strictEqual(get?.mutates, false)
    assert.deepStrictEqual(get?.effects, ['reads-blackfin-state'])
  })

  it('checkpoint set rejects empty text and requires a known repository', async () => {
    const set = resolveCommand('checkpoint set')!
    await assert.rejects(() =>
      set.run({
        args: { text: '   ' },
        cwd: '/Users/x/proj/wt-a',
        resolveRepository: async () => knownRepo,
        app,
      })
    )
    await assert.rejects(() =>
      set.run({
        args: { text: 'hello' },
        cwd: '/tmp/nowhere',
        resolveRepository: async () => null,
        app,
      })
    )
  })

  it('checkpoint set normalizes the text it returns', async () => {
    const set = resolveCommand('checkpoint set')!
    const data = (await set.run({
      args: { text: 'a\nb\x1b[31m' },
      cwd: '/Users/x/proj/wt-a',
      resolveRepository: async () => knownRepo,
      app,
    })) as { worktree: string; checkpoint: { text: string } | null }
    assert.strictEqual(data.worktree, '/Users/x/proj/wt-a')
    assert.strictEqual(data.checkpoint?.text, 'a b')
  })

  it('checkpoint set --clear returns a null checkpoint', async () => {
    const set = resolveCommand('checkpoint set')!
    const data = (await set.run({
      args: { clear: true },
      cwd: '/Users/x/proj/wt-a',
      resolveRepository: async () => knownRepo,
      app,
    })) as { checkpoint: unknown }
    assert.strictEqual(data.checkpoint, null)
  })

  it('both checkpoint commands satisfy the schema invariants', () => {
    // Guards the same rules buildCapabilities enforces, scoped to these two.
    for (const name of ['checkpoint set', 'checkpoint get']) {
      const command = allCommands().find(c => c.name === name)
      assert.ok(command !== undefined)
      assert.ok(command.summary.trim().length > 0)
      assert.ok(command.examples.length >= 1)
      assert.ok(command.exitCodes.includes(0))
      assert.ok(command.exitCodes.includes(2))
    }
  })
})
