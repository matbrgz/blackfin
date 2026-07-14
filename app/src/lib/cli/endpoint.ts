// Where the CLI transport lives on disk, and how the CLI finds it (#61). Pure:
// path and name computation only. The file writes (endpoint.json at mode 0600,
// the socket bind) are the caller's — the main process — so these functions can
// be tested without touching the filesystem.

import { createHash } from 'crypto'
import * as Path from 'path'
import { ICLIEndpoint, CLIProtocolVersion } from './protocol'

/**
 * Overrides the discovery path. Intended for dev and tests; it is honored
 * whenever set and non-empty (not gated to a dev build), so it only ever
 * redirects the CLI's own endpoint lookup — the token in the target
 * `endpoint.json` is still what authorizes a connection.
 */
export const EndpointEnvVar = 'BLACKFIN_ENDPOINT'

export type Transport = 'unix' | 'pipe'

/**
 * The `sun_path` limit for a unix domain socket. macOS/BSD allow 104 bytes
 * (Linux 108); we use the tighter value so a path that binds on our primary
 * platform binds everywhere. The socket path includes the OS-assigned userData
 * directory, so a long enough home path can exceed this — the server checks
 * `unixSocketPathWithinLimit` before `bind()` to fail with a clear message
 * instead of an opaque EINVAL.
 */
export const MaxUnixSocketPathBytes = 104

/** The directory holding the socket and `endpoint.json`, created mode 0700. */
export function cliDirectory(userDataDir: string): string {
  return Path.join(userDataDir, 'cli')
}

/**
 * Where `endpoint.json` is read/written. `BLACKFIN_ENDPOINT` wins when set and
 * non-empty, so a dev build or a test can point the CLI at a throwaway endpoint.
 */
export function resolveEndpointPath(
  userDataDir: string,
  env: NodeJS.ProcessEnv
): string {
  const override = env[EndpointEnvVar]
  if (override !== undefined && override.length > 0) {
    return override
  }
  return Path.join(cliDirectory(userDataDir), 'endpoint.json')
}

/** A named pipe on Windows, a unix domain socket everywhere else. */
export function transportForPlatform(platform: NodeJS.Platform): Transport {
  return platform === 'win32' ? 'pipe' : 'unix'
}

/**
 * The socket/pipe address. On POSIX a unix socket inside the (0700) cli
 * directory — the directory ACL is the defense. On Windows a named pipe whose
 * name is hashed from `userData`, so two installs or two users never collide on
 * one pipe (the pipe ACL there is not controllable from Node, so the token in
 * the ACL-protected `endpoint.json` is the defense instead).
 */
export function resolveSocketPath(
  platform: NodeJS.Platform,
  userDataDir: string
): string {
  if (platform === 'win32') {
    const hash = createHash('sha256')
      .update(userDataDir)
      .digest('hex')
      .slice(0, 16)
    return `\\\\.\\pipe\\blackfin-agent-${hash}`
  }
  return Path.join(cliDirectory(userDataDir), 'agent.sock')
}

/**
 * Whether a unix socket path fits within `sun_path`. The server calls this
 * before binding so an over-long path (a very long userData/home directory)
 * fails with a clear message rather than a bare bind() EINVAL. Windows pipe
 * names are not subject to this limit.
 */
export function unixSocketPathWithinLimit(socketPath: string): boolean {
  // The kernel needs room for the trailing NUL, so the usable length is one
  // less than the buffer size.
  return Buffer.byteLength(socketPath, 'utf8') < MaxUnixSocketPathBytes
}

/**
 * Build the descriptor to serialize into `endpoint.json` on app start. `token`
 * must be a hex string: `parseEndpoint` (the CLI-side reader) rejects any
 * endpoint whose token is not `/^[0-9a-f]+$/i`, so the caller's token
 * generator must emit hex (e.g. `randomBytes(n).toString('hex')`).
 */
export function buildEndpoint(params: {
  readonly platform: NodeJS.Platform
  readonly userDataDir: string
  readonly token: string
  readonly appVersion: string
  readonly pid: number
  readonly startedAt: number
}): ICLIEndpoint {
  return {
    protocol: CLIProtocolVersion,
    transport: transportForPlatform(params.platform),
    path: resolveSocketPath(params.platform, params.userDataDir),
    token: params.token,
    appVersion: params.appVersion,
    pid: params.pid,
    startedAt: params.startedAt,
  }
}
