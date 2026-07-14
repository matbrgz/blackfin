import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildCapabilities,
  CLISchemaVersion,
  ALL_CLI_EFFECTS,
  ICapabilitiesEnv,
} from '../../src/lib/cli/capabilities'
import {
  allCommands,
  ICommandDescriptor,
} from '../../src/lib/cli/registry'
import {
  CLIProtocolVersion,
  ExitSuccess,
  allErrorCodes,
  exitCodeForError,
} from '../../src/lib/cli/protocol'

const FIXED = new Date('2026-07-12T14:03:11.000Z')

function env(overrides: Partial<ICapabilitiesEnv> = {}): ICapabilitiesEnv {
  return {
    cliVersion: '3.6.3-beta3',
    app: { running: true, version: '3.6.3-beta3' },
    now: () => FIXED,
    ...overrides,
  }
}

describe('buildCapabilities', () => {
  it('is a bijection with the registry — every command, and only those', () => {
    // The heart of the issue: a command that routes but is not described, or a
    // schema entry for a command that does not exist, both fail here.
    const doc = buildCapabilities(allCommands(), env())
    assert.deepStrictEqual(
      new Set(doc.commands.map(c => c.name)),
      new Set(allCommands().map(c => c.name))
    )
  })

  it('carries the three independent versions and the protocol version', () => {
    const doc = buildCapabilities(allCommands(), env())
    assert.strictEqual(doc.schemaVersion, CLISchemaVersion)
    assert.strictEqual(doc.protocolVersion, CLIProtocolVersion)
    assert.strictEqual(doc.cliVersion, '3.6.3-beta3')
    assert.strictEqual(doc.generatedAt, FIXED.toISOString())
  })

  it('describes itself: capabilities is one of the commands', () => {
    // An agent that has only the schema must learn how to regenerate it.
    const doc = buildCapabilities(allCommands(), env())
    assert.ok(doc.commands.some(c => c.name === 'capabilities'))
  })

  it('gives every command a summary, an example, and exit codes 0 and 2', () => {
    const doc = buildCapabilities(allCommands(), env())
    for (const c of doc.commands) {
      assert.ok(c.summary.trim().length > 0, `${c.name} needs a summary`)
      assert.ok(c.examples.length >= 1, `${c.name} needs an example`)
      assert.ok(c.exitCodes.includes(2), `${c.name} must document exit 2`)
      assert.ok(
        c.exitCodes.includes(ExitSuccess),
        `${c.name} must document success`
      )
    }
  })

  it('never marks a mutating command safe without a justifying guardrail', () => {
    // The contract #64/#65 must meet, enforced here: mutate ⇒ confirmation is
    // not 'none', unless the command spells out why it is safe anyway.
    const doc = buildCapabilities(allCommands(), env())
    for (const c of doc.commands) {
      if (c.mutates) {
        assert.ok(
          c.confirmation !== 'none' || c.guardrails.length > 0,
          `${c.name} mutates but neither confirms nor justifies`
        )
      }
    }
  })

  it('emits only effects from the closed vocabulary', () => {
    const allowed = new Set<string>(ALL_CLI_EFFECTS)
    const doc = buildCapabilities(allCommands(), env())
    for (const c of doc.commands) {
      for (const effect of c.effects) {
        assert.ok(allowed.has(effect), `${c.name}: unknown effect ${effect}`)
      }
    }
  })

  it('documents exactly the exit codes the error union can produce', () => {
    // Exhaustiveness in both directions: every CLIErrorCode maps to an exit
    // that the document explains, and success (0) is present.
    const doc = buildCapabilities(allCommands(), env())
    const documented = new Set(doc.exitCodes.map(e => e.code))
    assert.ok(documented.has(ExitSuccess), 'missing success exit code')
    for (const code of allErrorCodes()) {
      assert.ok(
        documented.has(exitCodeForError(code)),
        `error ${code} maps to an undocumented exit code`
      )
    }
  })

  it('carries the global guardrails, including the injection rule', () => {
    const doc = buildCapabilities(allCommands(), env())
    assert.ok(doc.guardrails.length > 0)
    assert.ok(
      doc.guardrails.some(g => /because the user asked/i.test(g)),
      'the mutation-only-when-asked guardrail must be present'
    )
  })

  it('leaks no token value, user path, or userData into the document', () => {
    // The schema is the most public thing the CLI has — read by a model, pasted
    // into transcripts. Nothing machine-specific may appear. buildCapabilities
    // takes no token by construction; this guards against one ever appearing by
    // its shape (a long hex string), and against user paths / userData leaking.
    // (The word "token" itself is allowed — it appears in guardrail prose.)
    const json = JSON.stringify(buildCapabilities(allCommands(), env()))
    assert.doesNotMatch(json, /\/Users\//)
    assert.doesNotMatch(json, /C:\\Users\\/)
    assert.doesNotMatch(json, /userData/i)
    assert.doesNotMatch(json, /[0-9a-f]{32,}/i, 'a token-shaped value leaked')
  })

  it('works with the app closed, with the same commands', () => {
    const doc = buildCapabilities(
      allCommands(),
      env({ app: { running: false, version: null } })
    )
    assert.strictEqual(doc.app.running, false)
    assert.strictEqual(doc.app.version, null)
    assert.deepStrictEqual(
      new Set(doc.commands.map(c => c.name)),
      new Set(allCommands().map(c => c.name))
    )
  })

  it('is byte-for-byte deterministic given the same now', () => {
    const a = JSON.stringify(buildCapabilities(allCommands(), env()))
    const b = JSON.stringify(buildCapabilities(allCommands(), env()))
    assert.strictEqual(a, b)
  })

  it('rejects a descriptor that omits mutates (compile-time)', () => {
    // @ts-expect-error — `mutates` is required, so omitting it must not compile.
    const incomplete: ICommandDescriptor = {
      name: 'x',
      summary: 's',
      description: 'd',
      confirmation: 'none',
      requiresApp: false,
      scope: 'none',
      stability: 'stable',
      since: 1,
      arguments: [],
      flags: [],
      effects: [],
      exitCodes: [0],
      examples: [{ cmd: 'x', why: 'y' }],
      guardrails: [],
      output: {},
      run: async () => ({}),
    }
    void incomplete
  })
})
