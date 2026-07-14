import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CLIProtocolVersion,
  MaxRequestBytes,
  exitCodeForError,
  allErrorCodes,
  ExitSuccess,
  ICLIRequest,
  encodeLine,
  decodeRequest,
  decodeResponse,
  okResponse,
  errorResponse,
  checkProtocol,
  parseEndpoint,
  ICLIEndpoint,
} from '../../src/lib/cli/protocol'

function request(over: Partial<ICLIRequest> = {}): ICLIRequest {
  return {
    protocol: CLIProtocolVersion,
    id: 'id-1',
    token: 'tok',
    command: 'ping',
    args: {},
    cwd: '/x',
    client: { name: 'blackfin-cli', version: '1.0.0' },
    ...over,
  }
}

// Derived from the mapping itself, so a code added to the union (and thus to
// the mapping, which the Record forces) is automatically covered here too.
const ALL_ERROR_CODES = allErrorCodes()

describe('CLI protocol framing', () => {
  it('round-trips a request through encode/decode', () => {
    const req = request({ args: { verbose: true, paths: ['a', 'b'] } })
    const result = decodeRequest(encodeLine(req))
    assert.strictEqual(result.kind, 'ok')
    assert.deepStrictEqual(result.kind === 'ok' ? result.value : null, req)
  })

  it('round-trips a response through encode/decode', () => {
    const res = okResponse('id-1', { hello: 'world' })
    const decoded = decodeResponse(encodeLine(res), 'id-1')
    assert.deepStrictEqual(decoded, res)
  })

  it('round-trips a no-data success without turning it into an error', () => {
    // A command that succeeds with no payload: `okResponse` normalizes the
    // absent `data` to `null` so the key survives JSON serialization and the
    // CLI-side shape check still recognizes the envelope as `ok: true`.
    const res = okResponse('id-2', undefined)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.ok === true ? res.data : 'x', null)
    const decoded = decodeResponse(encodeLine(res), 'id-2')
    assert.strictEqual(decoded.ok, true)
    assert.deepStrictEqual(decoded, res)
  })

  it('accepts an ok envelope that arrives with no data key at all', () => {
    // A peer that omits `data` on the wire (an older or hand-built producer)
    // must still be read as a success, not rewritten into an internal error.
    const line =
      JSON.stringify({ protocol: CLIProtocolVersion, id: 'id-3', ok: true }) +
      '\n'
    const decoded = decodeResponse(line, 'id-3')
    assert.strictEqual(decoded.ok, true)
    assert.strictEqual(decoded.id, 'id-3')
  })

  it('turns a malformed response line into an internal error, never a throw', () => {
    const decoded = decodeResponse('{not json', 'id-9')
    assert.strictEqual(decoded.ok, false)
    assert.strictEqual(
      decoded.ok === false ? decoded.error.code : null,
      'internal'
    )
    assert.strictEqual(decoded.id, 'id-9')
  })

  it('turns a valid-JSON but wrong-shape response into an internal error', () => {
    // Syntactically valid JSON that is not a response envelope. Without the
    // shape check the CLI would read `.error.message` off these and throw.
    for (const line of ['42', 'null', '"hi"', '{"ok":false}', '{"ok":true}']) {
      const decoded = decodeResponse(line, 'id-x')
      assert.strictEqual(decoded.ok, false, line)
      assert.ok(decoded.ok === false && decoded.error.code === 'internal', line)
      assert.strictEqual(decoded.id, 'id-x')
    }
  })

  it('rejects an oversized line before parsing it', () => {
    // A line over the limit whose body is not even valid JSON: if it parsed, it
    // would throw; `too-large` proves the size check runs first.
    const huge = 'x'.repeat(MaxRequestBytes + 1)
    assert.strictEqual(decodeRequest(huge).kind, 'too-large')
  })

  it('accepts a line exactly at the limit', () => {
    const padding = MaxRequestBytes - encodeLine(request()).length
    const req = request({ token: 't'.repeat(Math.max(0, padding)) })
    assert.ok(Buffer.byteLength(encodeLine(req)) <= MaxRequestBytes)
    assert.strictEqual(decodeRequest(encodeLine(req)).kind, 'ok')
  })
})

describe('CLI exit codes', () => {
  it('maps every error code to exactly one exit code', () => {
    for (const code of ALL_ERROR_CODES) {
      const exit = exitCodeForError(code)
      assert.strictEqual(typeof exit, 'number')
      assert.notStrictEqual(
        exit,
        ExitSuccess,
        `${code} must not map to success`
      )
    }
  })

  it('covers every documented exit code with at least one error', () => {
    const documented = [2, 3, 4, 5, 6, 7, 70]
    const produced = new Set(ALL_ERROR_CODES.map(exitCodeForError))
    for (const exit of documented) {
      assert.ok(produced.has(exit), `no error maps to exit ${exit}`)
    }
    // And no error maps to an undocumented code.
    for (const exit of produced) {
      assert.ok(documented.includes(exit), `undocumented exit ${exit}`)
    }
  })
})

describe('checkProtocol', () => {
  it('accepts the supported version', () => {
    assert.strictEqual(checkProtocol(CLIProtocolVersion).ok, true)
  })

  it('rejects a mismatch, naming both versions', () => {
    const result = checkProtocol(CLIProtocolVersion + 1)
    assert.strictEqual(result.ok, false)
    if (result.ok === false) {
      assert.ok(result.message.includes(String(CLIProtocolVersion)))
      assert.ok(result.message.includes(String(CLIProtocolVersion + 1)))
    }
  })
})

describe('errorResponse / okResponse', () => {
  it('omits an absent hint and includes a present one', () => {
    const without = errorResponse('id', 'failed', 'nope')
    assert.ok(without.ok === false && without.error.hint === undefined)
    const withHint = errorResponse('id', 'failed', 'nope', 'try again')
    assert.ok(withHint.ok === false && withHint.error.hint === 'try again')
  })

  it('omits empty warnings', () => {
    const res = okResponse('id', {}, [])
    assert.ok(res.ok === true && res.warnings === undefined)
  })
})

describe('parseEndpoint', () => {
  const valid: ICLIEndpoint = {
    protocol: 1,
    transport: 'unix',
    path: '/tmp/agent.sock',
    token: 'a'.repeat(64),
    appVersion: '3.6.3',
    pid: 42,
    startedAt: 123,
  }

  it('accepts a well-formed endpoint', () => {
    assert.deepStrictEqual(parseEndpoint({ ...valid }), valid)
  })

  it('rejects malformed shapes without throwing', () => {
    assert.strictEqual(parseEndpoint(null), null)
    assert.strictEqual(parseEndpoint('nope'), null)
    assert.strictEqual(parseEndpoint({ ...valid, transport: 'tcp' }), null)
    assert.strictEqual(parseEndpoint({ ...valid, token: '' }), null)
    assert.strictEqual(parseEndpoint({ ...valid, path: 42 }), null)
    const noPid: Record<string, unknown> = { ...valid }
    delete noPid.pid
    assert.strictEqual(parseEndpoint(noPid), null)
  })

  it('rejects a non-hex token and non-finite / non-positive numbers', () => {
    assert.strictEqual(parseEndpoint({ ...valid, token: 'not-hex!' }), null)
    assert.strictEqual(parseEndpoint({ ...valid, pid: NaN }), null)
    assert.strictEqual(parseEndpoint({ ...valid, pid: 0 }), null)
    assert.strictEqual(parseEndpoint({ ...valid, pid: -1 }), null)
    assert.strictEqual(parseEndpoint({ ...valid, pid: 1.5 }), null)
    assert.strictEqual(parseEndpoint({ ...valid, startedAt: Infinity }), null)
    assert.strictEqual(parseEndpoint({ ...valid, startedAt: -1 }), null)
  })
})
