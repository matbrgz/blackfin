import { describe, it } from 'node:test'
import assert from 'node:assert'
import { buildRequest, exitCodeForResponse } from '../../src/lib/cli/client'
import {
  CLIProtocolVersion,
  ExitSuccess,
  okResponse,
  errorResponse,
  allErrorCodes,
  exitCodeForError,
} from '../../src/lib/cli/protocol'

describe('buildRequest', () => {
  it('stamps the protocol and carries the fields through', () => {
    const req = buildRequest({
      id: 'u-1',
      token: 'tok',
      command: 'ping',
      args: { verbose: true },
      cwd: '/proj',
      client: { name: 'blackfin-cli', version: '1.2.3' },
    })
    assert.strictEqual(req.protocol, CLIProtocolVersion)
    assert.strictEqual(req.id, 'u-1')
    assert.strictEqual(req.command, 'ping')
    assert.deepStrictEqual(req.args, { verbose: true })
    assert.strictEqual(req.cwd, '/proj')
    assert.deepStrictEqual(req.client, {
      name: 'blackfin-cli',
      version: '1.2.3',
    })
  })
})

describe('exitCodeForResponse', () => {
  it('maps a success to 0', () => {
    assert.strictEqual(exitCodeForResponse(okResponse('id', {})), ExitSuccess)
  })

  it('maps each error to its error-code exit', () => {
    for (const code of allErrorCodes()) {
      const res = errorResponse('id', code, 'x')
      assert.strictEqual(exitCodeForResponse(res), exitCodeForError(code))
    }
  })

  it('maps app-not-running to 4 and unauthorized to 3', () => {
    assert.strictEqual(
      exitCodeForResponse(errorResponse('id', 'app-not-running', 'x')),
      4
    )
    assert.strictEqual(
      exitCodeForResponse(errorResponse('id', 'unauthorized', 'x')),
      3
    )
  })
})
