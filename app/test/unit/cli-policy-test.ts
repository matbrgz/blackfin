import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  resolvePolicy,
  IPolicyCommand,
  IPolicyContext,
} from '../../src/lib/cli/policy'
import {
  isConfirmationExpired,
  ConfirmationTtlMs,
} from '../../src/lib/cli/confirmation'
import { allCommands } from '../../src/lib/cli/registry'
import { exitCodeForError } from '../../src/lib/cli/protocol'
import type { CLIConfirmation } from '../../src/lib/cli/capabilities'

function cmd(
  mutates: boolean,
  confirmation: CLIConfirmation,
  name = 'x'
): IPolicyCommand {
  return { name, mutates, confirmation }
}

function ctx(overrides: Partial<IPolicyContext> = {}): IPolicyContext {
  // The real default: mutations are OFF. Tests that want them on say so.
  return { mutatingEnabled: false, ...overrides }
}

describe('resolvePolicy — reading is always safe', () => {
  it('lets a pure read run, even with mutations off and a hostile override', () => {
    const read = cmd(false, 'none', 'context list')
    assert.strictEqual(
      resolvePolicy(read, ctx({ mutatingEnabled: false })).kind,
      'auto'
    )
    // Even a per-command 'never' does not gate a read: the kill switch and the
    // policy govern power to change, never the ability to see.
    assert.strictEqual(
      resolvePolicy(read, ctx({ perCommand: { 'context list': 'never' } }))
        .kind,
      'auto'
    )
  })
})

describe('resolvePolicy — the kill switch', () => {
  it('refuses every mutating command while mutations are off', () => {
    for (const confirmation of ['none', 'always', 'policy'] as const) {
      const decision = resolvePolicy(
        cmd(true, confirmation),
        ctx({ mutatingEnabled: false })
      )
      assert.strictEqual(decision.kind, 'denied')
      if (decision.kind === 'denied') {
        assert.strictEqual(decision.reason, 'mutations-disabled')
        // Denials are always unauthorized → exit 3.
        assert.strictEqual(decision.code, 'unauthorized')
        assert.strictEqual(exitCodeForError(decision.code), 3)
        assert.ok(decision.message.length > 0)
        assert.match(decision.hint, /do not retry/i)
      }
    }
  })

  it('does not gate a non-mutating focus command with the mutation switch', () => {
    // `show diff` steals focus but changes no data; the mutation kill switch is
    // not its switch. With mutations off it still resolves by its policy.
    const showDiff = cmd(false, 'policy', 'show diff')
    assert.strictEqual(
      resolvePolicy(showDiff, ctx({ mutatingEnabled: false })).kind,
      'auto'
    )
  })
})

describe('resolvePolicy — a per-command "never" is an absolute veto', () => {
  it('refuses even an auto-tier command set to never', () => {
    const decision = resolvePolicy(
      cmd(true, 'none', 'checkpoint set'),
      ctx({ mutatingEnabled: true, perCommand: { 'checkpoint set': 'never' } })
    )
    assert.strictEqual(decision.kind, 'denied')
    if (decision.kind === 'denied') {
      assert.strictEqual(decision.reason, 'policy-forbidden')
      assert.strictEqual(exitCodeForError(decision.code), 3)
    }
  })

  it('refuses a confirm command set to never', () => {
    const decision = resolvePolicy(
      cmd(true, 'always', 'extension install'),
      ctx({
        mutatingEnabled: true,
        perCommand: { 'extension install': 'never' },
      })
    )
    assert.strictEqual(decision.kind, 'denied')
  })
})

describe('resolvePolicy — confirmation: always never downgrades to auto', () => {
  it('confirms with mutations on and no override', () => {
    assert.strictEqual(
      resolvePolicy(cmd(true, 'always'), ctx({ mutatingEnabled: true })).kind,
      'confirm'
    )
  })

  it('still confirms when the user set "allow" — there is no remember-forever', () => {
    // The security invariant: an 'always' command cannot be made silent, not
    // even by the user, not "for trusted sources". 'allow' is ignored here.
    const decision = resolvePolicy(
      cmd(true, 'always', 'extension install'),
      ctx({
        mutatingEnabled: true,
        perCommand: { 'extension install': 'allow' },
      })
    )
    assert.strictEqual(decision.kind, 'confirm')
  })
})

describe('resolvePolicy — auto tier (confirmation: none, mutates: true)', () => {
  const enabled = ctx({ mutatingEnabled: true })

  it('runs invisibly by default', () => {
    assert.strictEqual(
      resolvePolicy(cmd(true, 'none', 'checkpoint set'), enabled).kind,
      'auto'
    )
  })

  it('can be asked to confirm anyway', () => {
    assert.strictEqual(
      resolvePolicy(
        cmd(true, 'none', 'checkpoint set'),
        ctx({ mutatingEnabled: true, perCommand: { 'checkpoint set': 'ask' } })
      ).kind,
      'confirm'
    )
  })

  it('stays auto when explicitly allowed', () => {
    assert.strictEqual(
      resolvePolicy(
        cmd(true, 'none', 'checkpoint set'),
        ctx({
          mutatingEnabled: true,
          perCommand: { 'checkpoint set': 'allow' },
        })
      ).kind,
      'auto'
    )
  })
})

describe('resolvePolicy — policy tier (confirmation: policy)', () => {
  it('is allowed by default', () => {
    assert.strictEqual(
      resolvePolicy(cmd(false, 'policy', 'show diff'), ctx()).kind,
      'auto'
    )
  })

  it('upgrades to confirm when the user asks', () => {
    assert.strictEqual(
      resolvePolicy(
        cmd(false, 'policy', 'show diff'),
        ctx({ perCommand: { 'show diff': 'ask' } })
      ).kind,
      'confirm'
    )
  })

  it('is refused when the user sets never', () => {
    assert.strictEqual(
      resolvePolicy(
        cmd(false, 'policy', 'show diff'),
        ctx({ perCommand: { 'show diff': 'never' } })
      ).kind,
      'denied'
    )
  })
})

describe('resolvePolicy — exhaustive over the real registry', () => {
  it('lands every command in exactly one outcome, with mutations off', () => {
    for (const c of allCommands()) {
      const decision = resolvePolicy(c, ctx({ mutatingEnabled: false }))
      assert.ok(
        decision.kind === 'auto' ||
          decision.kind === 'confirm' ||
          decision.kind === 'denied',
        `${c.name} did not resolve to a single outcome`
      )
      // With mutations off, everything that mutates is denied and nothing else.
      if (c.mutates) {
        assert.strictEqual(
          decision.kind,
          'denied',
          `${c.name} mutates but was not denied with the switch off`
        )
      } else {
        assert.notStrictEqual(
          decision.kind,
          'denied',
          `${c.name} is non-mutating and must not be denied by the switch`
        )
      }
    }
  })

  it('routes each registry command as its confirmation declares, with mutations on', () => {
    const enabled = ctx({ mutatingEnabled: true })
    for (const c of allCommands()) {
      const decision = resolvePolicy(c, enabled)
      const expected: Record<CLIConfirmation, 'auto' | 'confirm'> = {
        none: 'auto',
        always: 'confirm',
        policy: 'auto',
      }
      assert.strictEqual(
        decision.kind,
        expected[c.confirmation],
        `${c.name} (${c.confirmation}) routed to ${decision.kind}`
      )
    }
  })
})

describe('registry invariants the safety model depends on', () => {
  it('has no command that deletes anything — not by effect, not by name', () => {
    // Deletion via CLI is forbidden by absence of code. A test that scans the
    // registry is the tripwire against someone adding one later.
    const deletionWord = /\b(delete|remove|rm|destroy|purge|erase|drop)\b/i
    for (const c of allCommands()) {
      assert.doesNotMatch(
        c.name,
        deletionWord,
        `${c.name} looks like a deletion command`
      )
      // The effect vocabulary itself carries no deletion effect; guard anyway.
      for (const effect of c.effects) {
        assert.doesNotMatch(effect, /delete|remove/i, `${c.name}: ${effect}`)
      }
    }
  })

  it('gives no confirm command a free-text flag the agent could inject', () => {
    // The card is written by Blackfin, never the agent. No confirm command may
    // carry a string-typed flag (a --reason / --message / --note surface); its
    // only string input is the required positional subject. This is the test
    // that stops someone adding --reason in six months.
    for (const c of allCommands()) {
      if (c.confirmation !== 'always') {
        continue
      }
      for (const flag of c.flags) {
        assert.notStrictEqual(
          flag.type,
          'string',
          `${c.name} has a free-text flag --${flag.name}; a confirm command must not`
        )
      }
      for (const arg of c.arguments) {
        if (arg.type === 'string') {
          assert.strictEqual(
            arg.required,
            true,
            `${c.name}: string argument ${arg.name} must be the required subject`
          )
        }
      }
    }
  })

  it('never exposes a diffLineNumber input anywhere', () => {
    // Attribution anchors are never a diff index (#67). No command may take one.
    for (const c of allCommands()) {
      for (const name of [
        ...c.arguments.map(a => a.name),
        ...c.flags.map(f => f.name),
      ]) {
        assert.doesNotMatch(
          name,
          /diffline|line-?number/i,
          `${c.name}: ${name}`
        )
      }
    }
  })
})

describe('isConfirmationExpired — silence is never consent', () => {
  it('is not expired before the deadline', () => {
    assert.strictEqual(
      isConfirmationExpired({ expiresAt: 1000 + ConfirmationTtlMs }, 1000),
      false
    )
  })

  it('is expired at and after the deadline', () => {
    assert.strictEqual(isConfirmationExpired({ expiresAt: 1000 }, 1000), true)
    assert.strictEqual(isConfirmationExpired({ expiresAt: 1000 }, 1001), true)
  })

  it('uses a five-minute window', () => {
    assert.strictEqual(ConfirmationTtlMs, 5 * 60 * 1000)
  })
})
