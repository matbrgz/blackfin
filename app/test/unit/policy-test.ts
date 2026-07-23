import { describe, it } from 'node:test'
import assert from 'node:assert'
import { CapabilityKind, ExtensionSource } from '../../src/models/extension'
import { AgentId } from '../../src/models/workspace-inventory'
import {
  evaluatePolicy,
  IOrgPolicy,
  IPolicySubject,
  policyBlockFor,
  PolicyMode,
} from '../../src/lib/marketplace/policy'

function subject(overrides: Partial<IPolicySubject> = {}): IPolicySubject {
  return {
    name: 'code-review',
    kind: CapabilityKind.Skill,
    agent: AgentId.ClaudeCode,
    source: ExtensionSource.Git,
    sourceRef: 'https://github.com/acme/skills',
    ...overrides,
  }
}

function policy(overrides: Partial<IOrgPolicy> = {}): IOrgPolicy {
  return { mode: PolicyMode.Blocklist, allow: [], block: [], ...overrides }
}

describe('evaluatePolicy — allowlist mode', () => {
  it('denies an item that matches no allow rule', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({
        mode: PolicyMode.Allowlist,
        allow: [{ id: 'a', host: 'trusted.example' }],
      })
    )
    assert.strictEqual(decision.kind, 'blocked')
    assert.strictEqual(
      decision.kind === 'blocked' ? decision.reason : null,
      'not-on-allowlist'
    )
    assert.strictEqual(
      decision.kind === 'blocked' ? decision.ruleId : 'x',
      null
    )
  })

  it('permits an item that matches an allow rule by host', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({
        mode: PolicyMode.Allowlist,
        allow: [{ id: 'a', host: 'github.com' }],
      })
    )
    assert.strictEqual(decision.kind, 'allowed')
  })

  it('an empty allowlist permits nothing (strict default-deny)', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({ mode: PolicyMode.Allowlist })
    )
    assert.strictEqual(decision.kind, 'blocked')
  })
})

describe('evaluatePolicy — blocklist mode', () => {
  it('blocks an item whose host is blocklisted, names the rule', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({ block: [{ id: 'bad-host', host: 'github.com' }] })
    )
    assert.strictEqual(decision.kind, 'blocked')
    assert.strictEqual(
      decision.kind === 'blocked' ? decision.reason : null,
      'blocklisted'
    )
    assert.strictEqual(
      decision.kind === 'blocked' ? decision.ruleId : null,
      'bad-host'
    )
  })

  it('allows an item that matches no block rule', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({ block: [{ id: 'other', host: 'evil.example' }] })
    )
    assert.strictEqual(decision.kind, 'allowed')
  })

  it('an empty blocklist permits everything (default-allow)', () => {
    assert.strictEqual(evaluatePolicy(subject(), policy()).kind, 'allowed')
  })
})

describe('evaluatePolicy — precedence and matching', () => {
  it('an explicit block beats an allow in allowlist mode', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({
        mode: PolicyMode.Allowlist,
        allow: [{ id: 'a', host: 'github.com' }],
        block: [{ id: 'b', name: 'code-review' }],
      })
    )
    assert.strictEqual(decision.kind, 'blocked')
    assert.strictEqual(
      decision.kind === 'blocked' ? decision.ruleId : null,
      'b'
    )
  })

  it('a rule matches only when EVERY specified field matches (all-of)', () => {
    // host matches but name does not → no match → allowed under blocklist mode.
    const decision = evaluatePolicy(
      subject(),
      policy({ block: [{ id: 'b', host: 'github.com', name: 'other-skill' }] })
    )
    assert.strictEqual(decision.kind, 'allowed')
  })

  it('a rule with no criteria matches nothing (not a wildcard)', () => {
    const decision = evaluatePolicy(
      subject(),
      policy({ block: [{ id: 'empty' }] })
    )
    assert.strictEqual(decision.kind, 'allowed')
  })

  it('matches an scp-like git remote host by equality, not substring', () => {
    const decision = evaluatePolicy(
      subject({ sourceRef: 'git@github.com:acme/skills.git' }),
      policy({ block: [{ id: 'b', host: 'github.com' }] })
    )
    assert.strictEqual(decision.kind, 'blocked')
    // A look-alike host that merely CONTAINS the substring must NOT match.
    const lookalike = evaluatePolicy(
      subject({ sourceRef: 'https://github.com.evil.example/x' }),
      policy({ block: [{ id: 'b', host: 'github.com' }] })
    )
    assert.strictEqual(lookalike.kind, 'allowed')
  })

  it('matches by exact sourceRef and by source kind', () => {
    assert.strictEqual(
      evaluatePolicy(
        subject(),
        policy({
          block: [{ id: 'r', sourceRef: 'https://github.com/acme/skills' }],
        })
      ).kind,
      'blocked'
    )
    assert.strictEqual(
      evaluatePolicy(
        subject(),
        policy({ block: [{ id: 's', source: ExtensionSource.Git }] })
      ).kind,
      'blocked'
    )
  })
})

describe('evaluatePolicy — degenerate input never throws', () => {
  it('a null sourceRef and empty policy are well-formed, not an exception', () => {
    const decision = evaluatePolicy(subject({ sourceRef: null }), policy())
    assert.strictEqual(decision.kind, 'allowed')
  })

  it('a host rule against a null sourceRef simply does not match', () => {
    const decision = evaluatePolicy(
      subject({ sourceRef: null }),
      policy({ block: [{ id: 'b', host: 'github.com' }] })
    )
    assert.strictEqual(decision.kind, 'allowed')
  })
})

describe('policyBlockFor — the #50 hook', () => {
  it('returns the reason string when blocked, null when allowed', () => {
    assert.strictEqual(
      policyBlockFor(
        subject(),
        policy({ block: [{ id: 'b', host: 'github.com' }] })
      ),
      'blocklisted'
    )
    assert.strictEqual(policyBlockFor(subject(), policy()), null)
  })
})
