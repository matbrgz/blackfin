import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  classifyEnvVar,
  isSensitiveName,
  sanitizeMcpUrl,
} from '../../src/lib/workspace/mcp/secrets'
import {
  DeclaredEnvValue,
  EnvVarPresence,
  ExternalSecretSource,
} from '../../src/models/mcp'

/** An environment that knows the given names — and only their names. */
function envWith(...names: Array<string>): (name: string) => boolean {
  const set = new Set(names)
  return name => set.has(name)
}

const noEnv = () => false

describe('classifyEnvVar — the decision table', () => {
  it('a non-empty literal is configured', () => {
    const v = classifyEnvVar(
      'GITHUB_TOKEN',
      { kind: 'literal', isEmpty: false },
      noEnv
    )
    assert.strictEqual(v.presence, EnvVarPresence.Configured)
  })

  it('an empty literal is missing', () => {
    const v = classifyEnvVar(
      'GITHUB_TOKEN',
      { kind: 'literal', isEmpty: true },
      noEnv
    )
    assert.strictEqual(v.presence, EnvVarPresence.Missing)
  })

  it('an interpolation whose target is in the environment is inherited', () => {
    const v = classifyEnvVar(
      'TOKEN',
      { kind: 'interpolation', referencedName: 'FOO' },
      envWith('FOO')
    )
    assert.strictEqual(v.presence, EnvVarPresence.Inherited)
  })

  it('an interpolation whose target is absent is missing', () => {
    const v = classifyEnvVar(
      'TOKEN',
      { kind: 'interpolation', referencedName: 'FOO' },
      noEnv
    )
    assert.strictEqual(v.presence, EnvVarPresence.Missing)
  })

  it('a VS Code input is externally stored, from the right source', () => {
    const v = classifyEnvVar(
      'API_KEY',
      { kind: 'external-reference', source: ExternalSecretSource.VsCodeInput },
      noEnv
    )
    assert.strictEqual(v.presence, EnvVarPresence.ExternallyStored)
    assert.strictEqual(v.externalSource, ExternalSecretSource.VsCodeInput)
  })

  it('a Codex bearer_token_env_var is externally stored via indirection', () => {
    const v = classifyEnvVar(
      'API_KEY',
      {
        kind: 'external-reference',
        source: ExternalSecretSource.EnvVarIndirection,
      },
      noEnv
    )
    assert.strictEqual(v.presence, EnvVarPresence.ExternallyStored)
    assert.strictEqual(v.externalSource, ExternalSecretSource.EnvVarIndirection)
  })

  it('a declared-only variable present in the environment is inherited', () => {
    const v = classifyEnvVar('HOME', { kind: 'declared-only' }, envWith('HOME'))
    assert.strictEqual(v.presence, EnvVarPresence.Inherited)
  })

  it('a declared-only variable absent from the environment is missing', () => {
    const v = classifyEnvVar('LINEAR_API_KEY', { kind: 'declared-only' }, noEnv)
    assert.strictEqual(v.presence, EnvVarPresence.Missing)
  })
})

describe('isSensitiveName', () => {
  it('flags the documented sensitive shapes', () => {
    for (const name of [
      'GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'DB_PASSWORD',
      'CLIENT_SECRET',
      'AWS_CREDENTIALS',
      'DATABASE_DSN',
      'AUTHORIZATION',
      'AUTH_HEADER',
      'TOKEN',
    ]) {
      assert.strictEqual(
        isSensitiveName(name),
        true,
        `${name} should be sensitive`
      )
    }
  })

  it('flags sensitive words without a `_` separator or in the middle', () => {
    for (const name of [
      'GITHUBTOKEN',
      'APIKEY',
      'X_AUTHORIZATION',
      'GITHUB_PAT',
      'DB_PASSWD',
    ]) {
      assert.strictEqual(
        isSensitiveName(name),
        true,
        `${name} should be sensitive`
      )
    }
  })

  it('does not flag ordinary names', () => {
    for (const name of [
      'HOME',
      'PATH',
      'PORT',
      'NODE_ENV',
      'MONKEY',
      'KEYBOARD',
      'REPO_PATTERN',
      'LANG',
    ]) {
      assert.strictEqual(
        isSensitiveName(name),
        false,
        `${name} should not be sensitive`
      )
    }
  })

  it('is case-insensitive', () => {
    assert.strictEqual(isSensitiveName('github_token'), true)
  })

  // The rule that keeps the boundary simple: sensitivity is emphasis, never
  // retention. A sensitive and an insensitive variable with the same declared
  // shape get the same presence — only the lock icon differs.
  it('changes only `sensitive`, never `presence`', () => {
    const declared: DeclaredEnvValue = { kind: 'literal', isEmpty: false }
    const secret = classifyEnvVar('GITHUB_TOKEN', declared, noEnv)
    const plain = classifyEnvVar('EDITOR', declared, noEnv)

    assert.strictEqual(secret.sensitive, true)
    assert.strictEqual(plain.sensitive, false)
    assert.strictEqual(secret.presence, plain.presence)
  })
})

describe('sanitizeMcpUrl', () => {
  it('strips userinfo and query, keeping scheme, host and path', () => {
    const out = sanitizeMcpUrl('https://u:p@host/mcp?token=abc')
    assert.strictEqual(out.url, 'https://host/mcp')
    assert.strictEqual(out.hadEmbeddedCredentials, true)
  })

  it('leaves a clean URL untouched and unflagged', () => {
    const out = sanitizeMcpUrl('https://host/mcp')
    assert.strictEqual(out.url, 'https://host/mcp')
    assert.strictEqual(out.hadEmbeddedCredentials, false)
  })

  it('preserves an explicit port', () => {
    const out = sanitizeMcpUrl('https://api.example.com:8443/mcp')
    assert.strictEqual(out.url, 'https://api.example.com:8443/mcp')
    assert.strictEqual(out.hadEmbeddedCredentials, false)
  })

  it('flags and strips a credential-bearing fragment', () => {
    const out = sanitizeMcpUrl('https://host/mcp#token=abc')
    assert.strictEqual(out.url, 'https://host/mcp')
    assert.strictEqual(out.hadEmbeddedCredentials, true)
  })

  it('returns null for an unparseable URL, with no excerpt to leak', () => {
    const out = sanitizeMcpUrl('this is not a url')
    assert.strictEqual(out.url, null)
    assert.strictEqual(out.hadEmbeddedCredentials, false)
  })

  // The worst case the query/userinfo stripping misses on its own: a token that
  // lives in the path, as webhook and deploy-hook URLs put it.
  it('redacts a token embedded in the path (Slack-webhook shape)', () => {
    const out = sanitizeMcpUrl(
      'https://hooks.slack.com/services/T00000000/B00000000/abcAO1LEcSoMPLE24Tk'
    )
    assert.strictEqual(
      out.url,
      'https://hooks.slack.com/services/T00000000/B00000000/[redacted]'
    )
    assert.strictEqual(out.hadEmbeddedCredentials, true)
    assert.ok(!out.url!.includes('abcAO1LEcSoMPLE24Tk'))
  })

  it('redacts a path-style API key but keeps the route around it', () => {
    const out = sanitizeMcpUrl(
      'https://api.example.com/v1/keys/sk-1a2b3c4d5e6f7g8h9i0j/mcp'
    )
    assert.strictEqual(
      out.url,
      'https://api.example.com/v1/keys/[redacted]/mcp'
    )
    assert.strictEqual(out.hadEmbeddedCredentials, true)
  })

  it('leaves ordinary short route segments intact', () => {
    const out = sanitizeMcpUrl('https://api.example.com/v1/workspace/mcp')
    assert.strictEqual(out.url, 'https://api.example.com/v1/workspace/mcp')
    assert.strictEqual(out.hadEmbeddedCredentials, false)
  })
})

// The canary at the classification boundary. The value cannot reach here — the
// input type has no field for it — so the guarantee is structural. This locks
// it: whatever `classifyEnvVar` emits, a known secret is never in it, and the
// output carries only the allowed keys. If someone adds a value-bearing field,
// this is where it surfaces.
describe('classification canary', () => {
  const Canary = 'ghp_CANARY_DO_NOT_LEAK_0123456789abcdef'
  const AllowedKeys = new Set([
    'name',
    'presence',
    'sensitive',
    'externalSource',
  ])

  const cases: Array<DeclaredEnvValue> = [
    { kind: 'literal', isEmpty: false },
    { kind: 'literal', isEmpty: true },
    { kind: 'interpolation', referencedName: 'FOO' },
    { kind: 'external-reference', source: ExternalSecretSource.VsCodeInput },
    { kind: 'declared-only' },
  ]

  it('never carries a value, whatever the declared shape', () => {
    for (const declared of cases) {
      const v = classifyEnvVar('GITHUB_TOKEN', declared, envWith('FOO'))
      assert.ok(
        !JSON.stringify(v).includes(Canary),
        'the classified variable must not contain the secret'
      )
      for (const key of Object.keys(v)) {
        assert.ok(AllowedKeys.has(key), `unexpected retained field: ${key}`)
      }
    }
  })
})
