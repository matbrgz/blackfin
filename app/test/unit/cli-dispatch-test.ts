import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DispatchOutcome,
  exitCodeForOutcome,
  renderCapabilities,
  renderCapabilitiesTable,
  resolveInvocation,
} from '../../src/lib/cli/dispatch'
import {
  buildCapabilities,
  ICapabilitiesEnv,
} from '../../src/lib/cli/capabilities'
import { allCommands } from '../../src/lib/cli/registry'
import {
  ExitSuccess,
  allErrorCodes,
  exitCodeForError,
} from '../../src/lib/cli/protocol'

const FIXED = new Date('2026-07-12T14:03:11.000Z')

function env(overrides: Partial<ICapabilitiesEnv> = {}): ICapabilitiesEnv {
  return {
    cliVersion: '3.6.3-beta3',
    app: { running: false, version: null },
    now: () => FIXED,
    ...overrides,
  }
}

const doc = () => buildCapabilities(allCommands(), env())

describe('resolveInvocation', () => {
  it('reads the command name from the first positional', () => {
    const resolved = resolveInvocation(
      { _: ['capabilities'] },
      { stdoutIsTTY: false }
    )
    assert.strictEqual(resolved.command, 'capabilities')
    assert.deepStrictEqual(resolved.positionals, ['capabilities'])
  })

  it('has a null command for the bare invocation', () => {
    const resolved = resolveInvocation({ _: [] }, { stdoutIsTTY: true })
    assert.strictEqual(resolved.command, null)
  })

  it('defaults to JSON when stdout is not a TTY', () => {
    const resolved = resolveInvocation(
      { _: ['capabilities'] },
      { stdoutIsTTY: false }
    )
    assert.strictEqual(resolved.format, 'json')
  })

  it('defaults to the human table when stdout is a TTY', () => {
    const resolved = resolveInvocation(
      { _: ['capabilities'] },
      { stdoutIsTTY: true }
    )
    assert.strictEqual(resolved.format, 'human')
  })

  it('lets an explicit --json override a TTY', () => {
    const resolved = resolveInvocation(
      { _: ['capabilities'], json: true },
      { stdoutIsTTY: true }
    )
    assert.strictEqual(resolved.format, 'json')
  })

  it('lets an explicit --no-json override a pipe', () => {
    // minimist yields `json: false` for `--no-json`; that must beat the default.
    const resolved = resolveInvocation(
      { _: ['capabilities'], json: false },
      { stdoutIsTTY: false }
    )
    assert.strictEqual(resolved.format, 'human')
  })

  it('carries --schema-only through', () => {
    const off = resolveInvocation(
      { _: ['capabilities'] },
      { stdoutIsTTY: false }
    )
    assert.strictEqual(off.schemaOnly, false)
    const on = resolveInvocation(
      { _: ['capabilities'], ['schema-only']: true },
      { stdoutIsTTY: false }
    )
    assert.strictEqual(on.schemaOnly, true)
  })

  it('recognizes help both as a flag and as the command', () => {
    assert.strictEqual(
      resolveInvocation({ _: [], help: true }, { stdoutIsTTY: true }).help,
      true
    )
    assert.strictEqual(
      resolveInvocation({ _: ['help'] }, { stdoutIsTTY: true }).help,
      true
    )
    assert.strictEqual(
      resolveInvocation({ _: ['capabilities'] }, { stdoutIsTTY: true }).help,
      false
    )
  })

  it('coerces numeric positionals to strings', () => {
    // minimist parses a bare `123` as a number; the command name is always text.
    const resolved = resolveInvocation({ _: [123] }, { stdoutIsTTY: false })
    assert.strictEqual(resolved.command, '123')
  })
})

describe('exitCodeForOutcome', () => {
  it('maps success to 0', () => {
    assert.strictEqual(exitCodeForOutcome({ kind: 'ok' }), ExitSuccess)
  })

  it('maps every error code through the shared error→exit table', () => {
    for (const code of allErrorCodes()) {
      const outcome: DispatchOutcome = { kind: 'error', code }
      assert.strictEqual(exitCodeForOutcome(outcome), exitCodeForError(code))
    }
  })

  it('maps an unknown command to exit 2 (usage)', () => {
    assert.strictEqual(
      exitCodeForOutcome({ kind: 'error', code: 'unknown-command' }),
      2
    )
  })
})

describe('renderCapabilities', () => {
  it('emits a single valid JSON object for the json format', () => {
    const out = renderCapabilities(doc(), 'json')
    const parsed = JSON.parse(out)
    assert.strictEqual(typeof parsed, 'object')
    assert.strictEqual(parsed.schemaVersion, doc().schemaVersion)
    assert.deepStrictEqual(
      new Set(parsed.commands.map((c: { name: string }) => c.name)),
      new Set(allCommands().map(c => c.name))
    )
  })

  it('routes the human format to the table', () => {
    assert.strictEqual(
      renderCapabilities(doc(), 'human'),
      renderCapabilitiesTable(doc())
    )
  })
})

describe('renderCapabilitiesTable', () => {
  it('has a header row with the safety-relevant columns', () => {
    const table = renderCapabilitiesTable(doc())
    const header = table.split('\n').find(line => line.includes('COMMAND'))
    assert.ok(header, 'a header row is present')
    for (const column of ['COMMAND', 'MUTATES', 'CONFIRM', 'APP', 'SUMMARY']) {
      assert.ok(header.includes(column), `header has ${column}`)
    }
  })

  it('lists every registered command by name', () => {
    const table = renderCapabilitiesTable(doc())
    for (const command of allCommands()) {
      assert.ok(
        table.includes(command.name),
        `${command.name} appears in the table`
      )
    }
  })

  it('reports the app state and points at the JSON source of truth', () => {
    const closed = renderCapabilitiesTable(doc())
    assert.match(closed, /app: not running/)
    assert.match(closed, /blackfin capabilities --json/)

    const open = renderCapabilitiesTable(
      buildCapabilities(
        allCommands(),
        env({ app: { running: true, version: '9.9.9' } })
      )
    )
    assert.match(open, /app: running \(9\.9\.9\)/)
  })

  it('uses no tab or control characters, so it lays out in any terminal', () => {
    const table = renderCapabilitiesTable(doc())
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(table, /[\t\x00-\x08\x0b\x0c\x0e-\x1f]/)
  })

  it('carries the guardrail prose for a human reader', () => {
    const table = renderCapabilitiesTable(doc())
    assert.match(table, /Guardrails:/)
    assert.match(table, /because the user asked/i)
  })
})
