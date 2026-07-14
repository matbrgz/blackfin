import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  EndpointEnvVar,
  cliDirectory,
  resolveEndpointPath,
  transportForPlatform,
  resolveSocketPath,
  buildEndpoint,
} from '../../src/lib/cli/endpoint'
import { parseEndpoint, CLIProtocolVersion } from '../../src/lib/cli/protocol'

const USER_DATA = '/home/x/.config/Blackfin'

describe('resolveEndpointPath', () => {
  it('defaults to endpoint.json under the cli directory', () => {
    const p = resolveEndpointPath(USER_DATA, {})
    assert.strictEqual(p, `${cliDirectory(USER_DATA)}/endpoint.json`)
  })

  it('honors BLACKFIN_ENDPOINT when set', () => {
    const p = resolveEndpointPath(USER_DATA, {
      [EndpointEnvVar]: '/tmp/e.json',
    })
    assert.strictEqual(p, '/tmp/e.json')
  })

  it('ignores an empty BLACKFIN_ENDPOINT', () => {
    const p = resolveEndpointPath(USER_DATA, { [EndpointEnvVar]: '' })
    assert.strictEqual(p, `${cliDirectory(USER_DATA)}/endpoint.json`)
  })
})

describe('transport and socket path', () => {
  it('uses a named pipe on Windows and a unix socket elsewhere', () => {
    assert.strictEqual(transportForPlatform('win32'), 'pipe')
    assert.strictEqual(transportForPlatform('darwin'), 'unix')
    assert.strictEqual(transportForPlatform('linux'), 'unix')
  })

  it('puts the unix socket under the cli directory', () => {
    assert.strictEqual(
      resolveSocketPath('linux', USER_DATA),
      `${cliDirectory(USER_DATA)}/agent.sock`
    )
  })

  it('names the Windows pipe from a stable hash of userData', () => {
    const a = resolveSocketPath('win32', USER_DATA)
    assert.match(a, /^\\\\\.\\pipe\\blackfin-agent-[0-9a-f]{16}$/)
    // Deterministic for the same userData, distinct for a different one.
    assert.strictEqual(a, resolveSocketPath('win32', USER_DATA))
    assert.notStrictEqual(a, resolveSocketPath('win32', '/other/profile'))
  })
})

describe('buildEndpoint', () => {
  it('produces an endpoint that parseEndpoint accepts, round-tripping', () => {
    const endpoint = buildEndpoint({
      platform: 'linux',
      userDataDir: USER_DATA,
      token: 'ab'.repeat(32),
      appVersion: '3.6.3',
      pid: 4242,
      startedAt: 1000,
    })
    assert.strictEqual(endpoint.protocol, CLIProtocolVersion)
    assert.strictEqual(endpoint.transport, 'unix')
    assert.strictEqual(endpoint.path, `${cliDirectory(USER_DATA)}/agent.sock`)
    // The validator the CLI uses must accept what the app writes.
    assert.deepStrictEqual(
      parseEndpoint(JSON.parse(JSON.stringify(endpoint))),
      endpoint
    )
  })
})
