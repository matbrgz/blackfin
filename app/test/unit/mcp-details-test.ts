import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentId, ContextScope } from '../../src/models/workspace-inventory'
import type { IMcpServer } from '../../src/models/extension'
import { parseMcpConfig } from '../../src/lib/workspace/mcp/normalize-mcp'
import {
  IMcpConsumerConfig,
  deriveMcpServerDetails,
  mcpServerFingerprint,
} from '../../src/lib/workspace/mcp/mcp-details'

// A token value we plant in an env VALUE. If it EVER appears in the serialized
// details view-model, the #45 secret boundary has broken. Distinctive so a
// substring search cannot miss it.
const PLANTED_SECRET = 'sk-PLANTED-SECRET-VALUE-do-not-leak-9f3a2b'

function stdioServer(
  name: string,
  command: string,
  args: ReadonlyArray<string>,
  declaredIn: string,
  envKeys: ReadonlyArray<string> = []
): IMcpServer {
  return {
    name,
    transport: 'stdio',
    command,
    args: [...args],
    envKeys: [...envKeys],
    declaredIn,
  }
}

function httpServer(
  name: string,
  declaredIn: string,
  transport: 'http' | 'sse' = 'http'
): IMcpServer {
  return {
    name,
    transport,
    command: null,
    args: [],
    envKeys: [],
    declaredIn,
  }
}

describe('deriveMcpServerDetails — transport derivation', () => {
  it('surfaces stdio command and args from the normalized server', () => {
    const server = stdioServer(
      'filesystem',
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', '/Users/x'],
      '~/.claude.json'
    )

    const details = deriveMcpServerDetails(server, [], [])

    assert.equal(details.name, 'filesystem')
    assert.equal(details.execution.transport, 'stdio')
    assert.deepEqual(details.execution, {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/x'],
    })
  })

  it('derives http transport with a null url (no url is retained by #43)', () => {
    const server = httpServer('linear', '.cursor/mcp.json', 'http')

    const details = deriveMcpServerDetails(server, [], [])

    assert.deepEqual(details.execution, { transport: 'http', url: null })
  })

  it('derives sse transport with a null url', () => {
    const server = httpServer('remote-sse', '.cursor/mcp.json', 'sse')

    const details = deriveMcpServerDetails(server, [], [])

    assert.deepEqual(details.execution, { transport: 'sse', url: null })
  })
})

describe('deriveMcpServerDetails — consumers', () => {
  it('lists each agent that declares the same server, once per config', () => {
    const claude = stdioServer(
      'filesystem',
      'npx',
      ['-y', 'fs'],
      '~/.claude.json'
    )
    const cursor = stdioServer('fs', 'npx', ['-y', 'fs'], '.cursor/mcp.json')

    // Same fingerprint requires the same declared name; here the Cursor alias
    // differs, so it is a DIFFERENT logical server and must NOT be a consumer.
    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server: claude,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Global,
        repositoryPath: null,
      },
      {
        server: cursor,
        agent: AgentId.Cursor,
        scope: ContextScope.Project,
        repositoryPath: '/repo-a',
      },
    ]

    const details = deriveMcpServerDetails(claude, configs, ['/repo-a'])

    assert.equal(details.consumers.length, 1)
    assert.equal(details.consumers[0].agent, AgentId.ClaudeCode)
  })

  it('matches two agents that declare the same fingerprint as two consumers, one server', () => {
    const claude = stdioServer(
      'filesystem',
      'npx',
      ['-y', 'fs'],
      '~/.claude.json'
    )
    const cursor = stdioServer(
      'filesystem',
      'npx',
      ['-y', 'fs'],
      '.cursor/mcp.json'
    )

    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server: claude,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Global,
        repositoryPath: null,
      },
      {
        server: cursor,
        agent: AgentId.Cursor,
        scope: ContextScope.Project,
        repositoryPath: '/repo-a',
      },
    ]

    const details = deriveMcpServerDetails(claude, configs, ['/repo-a'])

    assert.equal(details.consumers.length, 2)
    assert.deepEqual(
      details.consumers.map(c => c.agent).sort(),
      [AgentId.ClaudeCode, AgentId.Cursor].sort()
    )
  })

  it('dedups identical consumer entries across the config set', () => {
    const claude = stdioServer(
      'filesystem',
      'npx',
      ['-y', 'fs'],
      '~/.claude.json'
    )

    const one: IMcpConsumerConfig = {
      server: claude,
      agent: AgentId.ClaudeCode,
      scope: ContextScope.Global,
      repositoryPath: null,
    }
    // Same agent, scope, config path and declared name → one consumer.
    const configs = [one, { ...one }]

    const details = deriveMcpServerDetails(claude, configs, [])

    assert.equal(details.consumers.length, 1)
  })
})

describe('deriveMcpServerDetails — affected projects', () => {
  it('a project-scope consumer affects only its own repository', () => {
    const server = stdioServer('fs', 'npx', ['fs'], '/repo-a/.mcp.json')
    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Project,
        repositoryPath: '/repo-a',
      },
    ]

    const details = deriveMcpServerDetails(server, configs, [
      '/repo-a',
      '/repo-b',
      '/repo-c',
    ])

    assert.equal(details.affectedProjects.length, 1)
    assert.deepEqual(
      details.affectedProjects.map(p => ({
        path: p.repositoryPath,
        via: p.via,
      })),
      [{ path: '/repo-a', via: 'project-config' }]
    )
  })

  it('a global-scope consumer affects every known repository', () => {
    const server = stdioServer('fs', 'npx', ['fs'], '~/.claude.json')
    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Global,
        repositoryPath: null,
      },
    ]
    const repos = ['/repo-a', '/repo-b', '/repo-c']

    const details = deriveMcpServerDetails(server, configs, repos)

    assert.equal(details.affectedProjects.length, 3)
    assert.ok(details.affectedProjects.every(p => p.via === 'global-scope'))
    assert.deepEqual(
      details.affectedProjects.map(p => p.repositoryPath).sort(),
      repos
    )
  })

  it('reports a repo reached by both scopes once, with the more specific origin', () => {
    const server = stdioServer('fs', 'npx', ['fs'], '~/.claude.json')
    const globalCfg: IMcpConsumerConfig = {
      server,
      agent: AgentId.ClaudeCode,
      scope: ContextScope.Global,
      repositoryPath: null,
    }
    const projectCfg: IMcpConsumerConfig = {
      server: stdioServer('fs', 'npx', ['fs'], '/repo-a/.mcp.json'),
      agent: AgentId.Cursor,
      scope: ContextScope.Project,
      repositoryPath: '/repo-a',
    }

    const details = deriveMcpServerDetails(
      server,
      [globalCfg, projectCfg],
      ['/repo-a', '/repo-b']
    )

    const repoA = details.affectedProjects.filter(
      p => p.repositoryPath === '/repo-a'
    )
    assert.equal(repoA.length, 1)
    assert.equal(repoA[0].via, 'project-config')
  })

  it('a disabled consumer does not count as an affected project but is still a consumer', () => {
    const server = stdioServer('fs', 'npx', ['fs'], '/repo-a/.mcp.json')
    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server,
        agent: AgentId.Cursor,
        scope: ContextScope.Project,
        repositoryPath: '/repo-a',
        disabled: true,
      },
    ]

    const details = deriveMcpServerDetails(server, configs, ['/repo-a'])

    assert.equal(details.consumers.length, 1)
    assert.equal(details.consumers[0].disabled, true)
    assert.equal(details.affectedProjects.length, 0)
  })
})

describe('deriveMcpServerDetails — empty and edge inputs', () => {
  it('returns a well-formed empty result and never throws', () => {
    const server = stdioServer('fs', 'npx', [], '~/.claude.json')

    const details = deriveMcpServerDetails(server, [], [])

    assert.equal(details.name, 'fs')
    assert.deepEqual(details.consumers, [])
    assert.deepEqual(details.affectedProjects, [])
    assert.deepEqual(details.envKeys, [])
  })

  it('a global consumer with no known repositories yields no affected projects', () => {
    const server = stdioServer('fs', 'npx', [], '~/.claude.json')
    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Global,
        repositoryPath: null,
      },
    ]

    const details = deriveMcpServerDetails(server, configs, [])

    assert.equal(details.consumers.length, 1)
    assert.deepEqual(details.affectedProjects, [])
  })

  it('fingerprint distinguishes servers by name and by args', () => {
    const a = stdioServer('fs', 'npx', ['/home'], '~/.claude.json')
    const b = stdioServer('fs', 'npx', ['/etc'], '~/.claude.json')
    const c = stdioServer('other', 'npx', ['/home'], '~/.claude.json')

    assert.notEqual(mcpServerFingerprint(a), mcpServerFingerprint(b))
    assert.notEqual(mcpServerFingerprint(a), mcpServerFingerprint(c))
  })
})

describe('deriveMcpServerDetails — #45 security invariant', () => {
  it('never surfaces an env VALUE, only names — canary planted in a real config', () => {
    // Normalize a real config whose env carries a planted secret VALUE.
    const rawJson = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: PLANTED_SECRET,
            LINEAR_API_KEY: PLANTED_SECRET,
          },
        },
      },
    })

    const parsed = parseMcpConfig(rawJson, { configPath: '~/.claude.json' })
    assert.equal(parsed.servers.length, 1)
    const server = parsed.servers[0]

    const configs: ReadonlyArray<IMcpConsumerConfig> = [
      {
        server,
        agent: AgentId.ClaudeCode,
        scope: ContextScope.Global,
        repositoryPath: null,
      },
    ]

    const details = deriveMcpServerDetails(server, configs, ['/repo-a'])

    // Names survive; the value does not.
    assert.deepEqual([...details.envKeys].sort(), [
      'GITHUB_TOKEN',
      'LINEAR_API_KEY',
    ])

    const serialized = JSON.stringify(details)
    assert.equal(
      serialized.includes(PLANTED_SECRET),
      false,
      'the planted secret value must never appear in the details view-model'
    )
  })
})
