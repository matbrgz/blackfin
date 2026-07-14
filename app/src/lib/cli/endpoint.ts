// Where the CLI transport lives on disk, and how the CLI finds it (#61). Pure:
// path and name computation only. The file writes (endpoint.json at mode 0600,
// the socket bind) are the caller's — the main process — so these functions can
// be tested without touching the filesystem.

import { createHash } from 'crypto'
import * as Path from 'path'
import { ICLIEndpoint, CLIProtocolVersion } from './protocol'

/** Overrides the discovery path — for dev and tests, never in a shipped build. */
export const EndpointEnvVar = 'BLACKFIN_ENDPOINT'

export type Transport = 'unix' | 'pipe'

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

/** Build the descriptor to serialize into `endpoint.json` on app start. */
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
