import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IMcpValidationContext,
  IMcpValidationFinding,
  McpValidationCode,
  validateMcpServer,
} from '../../src/lib/workspace/mcp/validate-mcp'
import type { IMcpServer } from '../../src/models/extension'
import { EnvVarPresence, IMcpEnvVar } from '../../src/models/mcp'

/** Build a normalized server, overriding only the fields a case cares about. */
function server(overrides: Partial<IMcpServer> = {}): IMcpServer {
  return {
    name: 'example',
    transport: 'stdio',
    command: null,
    args: [],
    envKeys: [],
    declaredIn: '.mcp.json',
    ...overrides,
  }
}

/** An env-presence view (#45) — names and presence only, never a value. */
function envVar(name: string, presence: EnvVarPresence): IMcpEnvVar {
  return { name, presence, sensitive: false }
}

const noContext: IMcpValidationContext = { envVars: [] }

/** The set of codes present in a result, for concise assertions. */
function codesOf(findings: ReadonlyArray<IMcpValidationFinding>): Set<string> {
  return new Set(findings.map(f => f.code))
}

function hasCode(
  findings: ReadonlyArray<IMcpValidationFinding>,
  code: McpValidationCode
): boolean {
  return findings.some(f => f.code === code)
}

describe('validateMcpServer — transport', () => {
  it('an unknown transport is an error, and no shape checks run', () => {
    const bad = {
      ...server(),
      transport: 'carrier-pigeon',
    } as unknown as IMcpServer
    const { findings } = validateMcpServer(bad, noContext)
    assert.strictEqual(findings.length, 1)
    assert.strictEqual(findings[0].code, 'unknown-transport')
    assert.strictEqual(findings[0].severity, 'error')
  })

  it('a stdio server with a command and string args is clean', () => {
    const { findings } = validateMcpServer(
      server({ command: '/usr/bin/node', args: ['server.js'] }),
      noContext
    )
    assert.strictEqual(findings.length, 0)
  })
})

describe('validateMcpServer — stdio coherence', () => {
  it('stdio without a command is missing-command (error)', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'stdio', command: null }),
      noContext
    )
    assert.ok(hasCode(findings, 'missing-command'))
    assert.strictEqual(
      findings.find(f => f.code === 'missing-command')?.severity,
      'error'
    )
  })

  it('a whitespace-only command counts as missing', () => {
    const { findings } = validateMcpServer(
      server({ command: '   ' }),
      noContext
    )
    assert.ok(hasCode(findings, 'missing-command'))
  })

  it('args that are not an array of strings is invalid-args (error)', () => {
    const bad = server({ command: 'node' })
    const withStringArgs = {
      ...bad,
      args: 'server.js',
    } as unknown as IMcpServer
    const { findings } = validateMcpServer(withStringArgs, noContext)
    assert.ok(hasCode(findings, 'invalid-args'))

    const withObjectArgs = { ...bad, args: { 0: 'x' } } as unknown as IMcpServer
    assert.ok(
      hasCode(
        validateMcpServer(withObjectArgs, noContext).findings,
        'invalid-args'
      )
    )
  })

  it('a package runner is a warning that names the runner, not the package', () => {
    for (const command of ['npx', 'uvx', 'bunx', '/opt/bin/pnpx', 'NPX.CMD']) {
      const { findings } = validateMcpServer(
        server({ command, args: ['-y', '@vendor/server'] }),
        noContext
      )
      const runner = findings.find(f => f.code === 'command-is-a-runner')
      assert.ok(runner !== undefined, `expected runner finding for ${command}`)
      assert.strictEqual(runner!.severity, 'warning')
      assert.match(runner!.message, /not verified/i)
    }
  })

  it('an ordinary command is not flagged as a runner', () => {
    const { findings } = validateMcpServer(
      server({ command: '/usr/local/bin/my-server' }),
      noContext
    )
    assert.ok(!hasCode(findings, 'command-is-a-runner'))
  })

  it('a stdio server that also declares a URL is ambiguous (warning)', () => {
    const { findings } = validateMcpServer(server({ command: 'node' }), {
      envVars: [],
      url: 'https://api.example.com/mcp',
    })
    assert.ok(hasCode(findings, 'ambiguous-transport'))
    assert.strictEqual(
      findings.find(f => f.code === 'ambiguous-transport')?.severity,
      'warning'
    )
  })
})

describe('validateMcpServer — remote coherence', () => {
  it('http without a URL is missing-url (error)', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'http', command: null }),
      { envVars: [] }
    )
    assert.ok(hasCode(findings, 'missing-url'))
    assert.strictEqual(
      findings.find(f => f.code === 'missing-url')?.severity,
      'error'
    )
  })

  it('sse with a valid https URL is clean', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'sse', command: null }),
      { envVars: [], url: 'https://api.example.com/sse' }
    )
    assert.strictEqual(findings.length, 0)
  })

  it('a non-http scheme (ftp) is invalid-url (error)', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'http', command: null }),
      { envVars: [], url: 'ftp://example.com/resource' }
    )
    assert.ok(hasCode(findings, 'invalid-url'))
  })

  it('an unparseable URL is invalid-url and does not throw', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'http', command: null }),
      { envVars: [], url: 'http://[not a url' }
    )
    assert.ok(hasCode(findings, 'invalid-url'))
  })

  it('a remote server that also declares a command is ambiguous (warning)', () => {
    const { findings } = validateMcpServer(
      server({ transport: 'http', command: 'node' }),
      { envVars: [], url: 'https://api.example.com/mcp' }
    )
    assert.ok(hasCode(findings, 'ambiguous-transport'))
  })
})

describe('validateMcpServer — environment presence', () => {
  it('a missing variable is a warning that carries the name', () => {
    const { findings } = validateMcpServer(server({ command: 'node' }), {
      envVars: [envVar('LINEAR_API_KEY', EnvVarPresence.Missing)],
    })
    const missing = findings.find(f => f.code === 'env-var-missing')
    assert.ok(missing !== undefined)
    assert.strictEqual(missing!.severity, 'warning')
    assert.strictEqual(missing!.subject, 'LINEAR_API_KEY')
    assert.match(missing!.message, /LINEAR_API_KEY/)
  })

  it('configured, inherited and externally-stored variables produce no finding', () => {
    const { findings } = validateMcpServer(server({ command: 'node' }), {
      envVars: [
        envVar('A', EnvVarPresence.Configured),
        envVar('B', EnvVarPresence.Inherited),
        envVar('C', EnvVarPresence.ExternallyStored),
      ],
    })
    assert.strictEqual(findings.length, 0)
  })

  it('reports one finding per missing variable', () => {
    const { findings } = validateMcpServer(server({ command: 'node' }), {
      envVars: [
        envVar('A', EnvVarPresence.Missing),
        envVar('B', EnvVarPresence.Missing),
      ],
    })
    assert.strictEqual(
      findings.filter(f => f.code === 'env-var-missing').length,
      2
    )
  })
})

describe('validateMcpServer — a fully-valid config yields no findings', () => {
  it('stdio with a real binary, string args, and all env present', () => {
    const result = validateMcpServer(
      server({
        name: 'filesystem',
        command: '/usr/local/bin/mcp-fs',
        args: ['--root', '/tmp'],
        envKeys: ['HOME'],
      }),
      { envVars: [envVar('HOME', EnvVarPresence.Inherited)] }
    )
    assert.deepStrictEqual(result.findings, [])
    assert.strictEqual(result.serverName, 'filesystem')
  })
})

describe('validateMcpServer — never throws on degenerate input', () => {
  it('an all-empty / null-ish server returns a well-formed result', () => {
    const degenerate = {
      name: '',
      transport: 'stdio',
      command: null,
      args: [],
      envKeys: [],
      declaredIn: '',
    } as IMcpServer
    assert.doesNotThrow(() => validateMcpServer(degenerate, noContext))
    const { findings, serverName } = validateMcpServer(degenerate, noContext)
    assert.strictEqual(serverName, '')
    assert.ok(Array.isArray(findings))
    assert.ok(hasCode(findings, 'missing-command'))
  })

  it('an unknown transport with null-ish everything does not throw', () => {
    const wild = {
      name: 'x',
      transport: 42,
      command: null,
      args: null,
      envKeys: null,
      declaredIn: '',
    } as unknown as IMcpServer
    assert.doesNotThrow(() =>
      validateMcpServer(wild, { envVars: [], url: undefined })
    )
    assert.ok(
      codesOf(validateMcpServer(wild, noContext).findings).has(
        'unknown-transport'
      )
    )
  })

  it('an empty context and empty server produce a stable, ordered result', () => {
    const a = validateMcpServer(server({ command: 'node' }), noContext)
    const b = validateMcpServer(server({ command: 'node' }), noContext)
    assert.deepStrictEqual(a, b)
  })
})

describe('validateMcpServer — a secret value never reaches the output', () => {
  it('neither an env value nor URL credentials appear in any finding', () => {
    const SECRET = 'sup3r-s3cr3t-tok3n-value-should-never-appear'
    // The env-presence view is names-only by type; there is no field to put a
    // value in. We still assert the value never shows up if a caller mistakenly
    // used it as a NAME-adjacent input.
    const result = validateMcpServer(
      server({
        name: 'leaky',
        transport: 'http',
        command: null,
        envKeys: ['GITHUB_TOKEN'],
      }),
      {
        envVars: [envVar('GITHUB_TOKEN', EnvVarPresence.Missing)],
        // A structurally valid URL that carries credentials in userinfo and query.
        url: `https://user:${SECRET}@api.example.com/mcp?api_key=${SECRET}`,
      }
    )

    const serialized = JSON.stringify(result)
    assert.ok(
      !serialized.includes(SECRET),
      'the secret value must never appear in the validation output'
    )
    // The finding for the missing var carries the NAME, which is expected.
    assert.ok(serialized.includes('GITHUB_TOKEN'))
    // A valid https URL yields no invalid-url; the URL text is never surfaced.
    assert.ok(!hasCode(result.findings, 'invalid-url'))
    // Prove the URL text (scheme, host, credentials) never reaches the output by
    // asserting no URL scheme separator survives — a stronger check than matching
    // one host literal, and it avoids substring-sanitising a URL by hostname.
    assert.ok(!/:\/\//.test(serialized), 'no URL is surfaced in any finding')
  })
})
