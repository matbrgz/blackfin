import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentId } from '../../src/models/workspace-inventory'
import {
  IMcpNormalizeResult,
  McpConfigFormat,
  classifyMcpConfigPath,
  parseMcpConfig,
} from '../../src/lib/workspace/mcp/normalize-mcp'

// A token value we plant in fixtures. If it EVER appears in a serialized
// result, the secret boundary has broken. Deliberately distinctive so a
// substring search cannot miss it.
const PLANTED_SECRET = 'sk-PLANTED-SECRET-VALUE-do-not-leak-9f3a2b'

function warningKinds(result: IMcpNormalizeResult): ReadonlyArray<string> {
  return result.warnings.map(w => w.kind)
}

describe('classifyMcpConfigPath', () => {
  it('classifies repo-root .mcp.json as Claude / mcpServers', () => {
    assert.deepEqual(classifyMcpConfigPath('.mcp.json'), {
      agent: AgentId.ClaudeCode,
      format: McpConfigFormat.McpServersMap,
    })
  })

  it('classifies home-root .claude.json as Claude / mcpServers', () => {
    assert.deepEqual(classifyMcpConfigPath('.claude.json'), {
      agent: AgentId.ClaudeCode,
      format: McpConfigFormat.McpServersMap,
    })
  })

  it('classifies .cursor/mcp.json as Cursor / mcpServers', () => {
    assert.deepEqual(classifyMcpConfigPath('.cursor/mcp.json'), {
      agent: AgentId.Cursor,
      format: McpConfigFormat.McpServersMap,
    })
  })

  it('classifies .vscode/mcp.json as Copilot / vscode-servers', () => {
    assert.deepEqual(classifyMcpConfigPath('.vscode/mcp.json'), {
      agent: AgentId.Copilot,
      format: McpConfigFormat.VsCodeServers,
    })
  })

  it('classifies opencode.json (root and .opencode/) as OpenCode / opencode-mcp', () => {
    assert.deepEqual(classifyMcpConfigPath('opencode.json'), {
      agent: AgentId.OpenCode,
      format: McpConfigFormat.OpenCodeMcp,
    })
    assert.deepEqual(classifyMcpConfigPath('.opencode/opencode.json'), {
      agent: AgentId.OpenCode,
      format: McpConfigFormat.OpenCodeMcp,
    })
  })

  it('classifies .gemini/settings.json as Gemini / mcpServers', () => {
    assert.deepEqual(classifyMcpConfigPath('.gemini/settings.json'), {
      agent: AgentId.Gemini,
      format: McpConfigFormat.McpServersMap,
    })
  })

  it('returns null for non-MCP paths and for TOML configs (out of scope here)', () => {
    assert.equal(classifyMcpConfigPath('.cursor/rules/foo.mdc'), null)
    assert.equal(classifyMcpConfigPath('README.md'), null)
    assert.equal(classifyMcpConfigPath('.codex/config.toml'), null)
    assert.equal(classifyMcpConfigPath('src/index.ts'), null)
  })
})

describe('parseMcpConfig — the mcpServers map (Claude / Cursor / Gemini)', () => {
  it('normalizes a stdio server, extracting only env KEY names', () => {
    const raw = JSON.stringify({
      mcpServers: {
        github: {
          command: 'gh-mcp',
          args: ['--stdio'],
          env: { GITHUB_TOKEN: PLANTED_SECRET },
        },
      },
    })
    const result = parseMcpConfig(raw, { configPath: '.mcp.json' })
    assert.equal(result.servers.length, 1)
    const server = result.servers[0]
    assert.equal(server.name, 'github')
    assert.equal(server.transport, 'stdio')
    assert.equal(server.command, 'gh-mcp')
    assert.deepEqual(server.args, ['--stdio'])
    assert.deepEqual(server.envKeys, ['GITHUB_TOKEN'])
    assert.equal(server.declaredIn, '.mcp.json')
  })

  it('detects an http transport from a bare url, storing no url', () => {
    const raw = JSON.stringify({
      mcpServers: {
        sentry: { url: 'https://mcp.example.test/sse' },
      },
    })
    const result = parseMcpConfig(raw, { configPath: '.claude/mcp.json' })
    assert.equal(result.servers.length, 1)
    const server = result.servers[0]
    assert.equal(server.transport, 'http')
    assert.equal(server.command, null)
    assert.deepEqual(server.args, [])
    // IMcpServer has no url field, by design.
    assert.equal('url' in server, false)
  })

  it('normalizes all three servers of the multi-transport fixture', () => {
    const raw = JSON.stringify({
      mcpServers: {
        github: {
          command: 'gh-mcp',
          args: ['--stdio'],
          env: { GITHUB_TOKEN: PLANTED_SECRET },
        },
        filesystem: { command: 'fs-mcp', args: ['/repo'] },
        sentry: { url: 'https://mcp.example.test/sse' },
      },
    })
    const result = parseMcpConfig(raw, { configPath: '.claude/mcp.json' })
    assert.equal(result.servers.length, 3)
    assert.deepEqual(
      result.servers.map(s => s.name),
      ['github', 'filesystem', 'sentry']
    )
    assert.deepEqual(
      result.servers.map(s => s.transport),
      ['stdio', 'stdio', 'http']
    )
  })

  it('honours an explicit sse transport (legacy)', () => {
    const raw = JSON.stringify({
      mcpServers: {
        legacy: { type: 'sse', url: 'https://mcp.example.test/sse' },
      },
    })
    const result = parseMcpConfig(raw, { configPath: '.mcp.json' })
    assert.equal(result.servers[0].transport, 'sse')
  })

  it('reads servers nested under projects[<path>].mcpServers (~/.claude.json)', () => {
    const raw = JSON.stringify({
      mcpServers: { global: { command: 'g-mcp' } },
      projects: {
        '/home/u/repo': {
          mcpServers: {
            local: { command: 'l-mcp', env: { API_KEY: PLANTED_SECRET } },
          },
        },
      },
    })
    const result = parseMcpConfig(raw, { configPath: '.claude.json' })
    assert.deepEqual(result.servers.map(s => s.name).sort(), [
      'global',
      'local',
    ])
    const local = result.servers.find(s => s.name === 'local')!
    assert.deepEqual(local.envKeys, ['API_KEY'])
  })
})

describe('parseMcpConfig — VS Code servers', () => {
  it('reads the `servers` root key and ignores `inputs`', () => {
    const raw = JSON.stringify({
      servers: {
        db: { command: 'db-mcp', env: { PGPASSWORD: PLANTED_SECRET } },
      },
      inputs: [{ id: 'token', type: 'promptString' }],
    })
    const result = parseMcpConfig(raw, {
      configPath: '.vscode/mcp.json',
      format: McpConfigFormat.VsCodeServers,
    })
    assert.equal(result.servers.length, 1)
    assert.equal(result.servers[0].name, 'db')
    assert.deepEqual(result.servers[0].envKeys, ['PGPASSWORD'])
  })
})

describe('parseMcpConfig — OpenCode', () => {
  it('reads the `mcp` root key and command-as-array (head=command, tail=args)', () => {
    const raw = JSON.stringify({
      mcp: {
        fs: {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-filesystem'],
          environment: { ROOT_TOKEN: PLANTED_SECRET },
        },
        remote: { type: 'remote', url: 'https://mcp.example.test/x' },
      },
    })
    const result = parseMcpConfig(raw, {
      configPath: 'opencode.json',
      format: McpConfigFormat.OpenCodeMcp,
    })
    const fs = result.servers.find(s => s.name === 'fs')!
    assert.equal(fs.transport, 'stdio')
    assert.equal(fs.command, 'npx')
    assert.deepEqual(fs.args, ['-y', '@modelcontextprotocol/server-filesystem'])
    assert.deepEqual(fs.envKeys, ['ROOT_TOKEN'])
    const remote = result.servers.find(s => s.name === 'remote')!
    assert.equal(remote.transport, 'http')
  })
})

describe('parseMcpConfig — malformed / degenerate input never throws', () => {
  const bad: ReadonlyArray<[string, string]> = [
    ['empty string', ''],
    ['whitespace only', '   \n\t '],
    ['truncated json', '{ "mcpServers": { "x": { "command": "a" '],
    ['trailing comma', '{ "mcpServers": { "x": { "command": "a" }, } }'],
    ['top-level array', '[]'],
    ['top-level string', '"just a string"'],
    ['unknown root key', '{ "somethingElse": {} }'],
    ['mcpServers is an array', '{ "mcpServers": [] }'],
    ['entry is null', '{ "mcpServers": { "x": null } }'],
    ['entry is a string', '{ "mcpServers": { "x": "not-an-object" } }'],
    [
      'entry has neither command nor url',
      '{ "mcpServers": { "x": { "args": ["a"] } } }',
    ],
  ]

  for (const [label, raw] of bad) {
    it(`returns a result (never throws) for: ${label}`, () => {
      let result: IMcpNormalizeResult | null = null
      assert.doesNotThrow(() => {
        result = parseMcpConfig(raw, { configPath: '.mcp.json' })
      })
      assert.notEqual(result, null)
      // Degenerate input yields no usable servers and at least one warning.
      assert.equal(result!.servers.length, 0)
      assert.ok(result!.warnings.length >= 1)
    })
  }

  it('maps input to the right warning kinds', () => {
    assert.deepEqual(warningKinds(parseMcpConfig('', { configPath: 'p' })), [
      'empty',
    ])
    assert.deepEqual(
      warningKinds(parseMcpConfig('{ not json', { configPath: 'p' })),
      ['malformed-json']
    )
    assert.deepEqual(
      warningKinds(parseMcpConfig('{ "x": 1 }', { configPath: 'p' })),
      ['unrecognized-shape']
    )
    assert.deepEqual(
      warningKinds(
        parseMcpConfig('{ "mcpServers": { "x": { "args": [] } } }', {
          configPath: 'p',
        })
      ),
      ['unknown-transport']
    )
    assert.deepEqual(
      warningKinds(
        parseMcpConfig('{ "mcpServers": { "x": { "type": "stdio" } } }', {
          configPath: 'p',
        })
      ),
      ['missing-command']
    )
    assert.deepEqual(
      warningKinds(
        parseMcpConfig('{ "mcpServers": { "x": { "type": "http" } } }', {
          configPath: 'p',
        })
      ),
      ['missing-url']
    )
  })

  it('warnings carry the config path and a name — never a content excerpt', () => {
    const raw = `{ "mcpServers": { "broken": { "type": "stdio", "note": "${PLANTED_SECRET}" } } }`
    const result = parseMcpConfig(raw, { configPath: '.mcp.json' })
    assert.equal(result.warnings.length, 1)
    const warning = result.warnings[0]
    assert.equal(warning.kind, 'missing-command')
    assert.equal(warning.configPath, '.mcp.json')
    assert.equal(warning.declaredName, 'broken')
    assert.equal(JSON.stringify(warning).includes(PLANTED_SECRET), false)
  })
})

describe('parseMcpConfig — SECURITY: env values never leak', () => {
  // The secret is planted ONLY where a value must never survive: env values,
  // URL userinfo/query, and header values. It is deliberately NOT planted in
  // `command`/`args`, which ARE the user's own command line and are legitimately
  // preserved (they carry no env value). The guarantee under test is that no env
  // VALUE, URL VALUE, or header VALUE reaches the output — only NAMES do.
  it('a token in env/url/headers never appears in the output; only key names do', () => {
    const raw = JSON.stringify({
      mcpServers: {
        stdioServer: {
          command: 'srv',
          args: ['--flag', 'harmless-value'],
          env: {
            GITHUB_TOKEN: PLANTED_SECRET,
            API_KEY: PLANTED_SECRET,
            NESTED: PLANTED_SECRET,
          },
        },
        httpServer: {
          // URL with userinfo AND query string — classic token vectors.
          url: `https://user:${PLANTED_SECRET}@host.test/path?key=${PLANTED_SECRET}`,
          headers: { Authorization: `Bearer ${PLANTED_SECRET}` },
        },
        remoteWithType: {
          type: 'sse',
          serverUrl: `https://host.test/x?secret=${PLANTED_SECRET}`,
        },
      },
    })

    const result = parseMcpConfig(raw, { configPath: '.mcp.json' })

    // The whole result, serialized, must not contain the secret anywhere:
    // not in a value, not in a URL, not in a header, not in a warning.
    const serialized = JSON.stringify(result)
    assert.equal(
      serialized.includes(PLANTED_SECRET),
      false,
      'the planted secret leaked into the normalized output'
    )

    // But the KEY NAMES of env are preserved — that is the whole point.
    const stdio = result.servers.find(s => s.name === 'stdioServer')!
    assert.deepEqual(stdio.envKeys, ['GITHUB_TOKEN', 'API_KEY', 'NESTED'])

    // The remote servers carry no url/header field at all — the type has no slot.
    const http = result.servers.find(s => s.name === 'httpServer')!
    assert.equal('url' in http, false)
    assert.equal('headers' in http, false)
    assert.equal('headerNames' in http, false)
    assert.deepEqual(http.envKeys, [])
  })
})

describe('parseMcpConfig — auto-detection of dialect', () => {
  it('detects mcpServers, servers, and mcp without an explicit format', () => {
    assert.equal(
      parseMcpConfig('{ "mcpServers": { "a": { "command": "x" } } }', {
        configPath: 'p',
      }).servers.length,
      1
    )
    assert.equal(
      parseMcpConfig('{ "servers": { "a": { "command": "x" } } }', {
        configPath: 'p',
      }).servers.length,
      1
    )
    assert.equal(
      parseMcpConfig('{ "mcp": { "a": { "command": ["x"] } } }', {
        configPath: 'p',
      }).servers.length,
      1
    )
  })
})
