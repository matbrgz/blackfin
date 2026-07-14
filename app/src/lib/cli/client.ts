// The pure, no-I/O part of the CLI client (#61): assembling a request and
// turning a response into a process exit code. The socket connect, the
// endpoint.json read, and printing to stdout are the CLI process's job; keeping
// this logic here means the mapping an agent depends on is unit-tested.

import {
  CLIArgValue,
  CLIProtocolVersion,
  ExitSuccess,
  ICLIRequest,
  ICLIResponse,
  exitCodeForError,
} from './protocol'

/** The name and version the CLI identifies itself with on every request. */
export interface IClientIdentity {
  readonly name: string
  readonly version: string
}

/**
 * Assemble a request. `id` (a uuid) and `cwd` (an absolute, resolved path) are
 * passed in because producing them is I/O; everything else is fixed here.
 */
export function buildRequest(params: {
  readonly id: string
  readonly token: string
  readonly command: string
  readonly args: Readonly<Record<string, CLIArgValue>>
  readonly cwd: string
  readonly client: IClientIdentity
}): ICLIRequest {
  return {
    protocol: CLIProtocolVersion,
    id: params.id,
    token: params.token,
    command: params.command,
    args: params.args,
    cwd: params.cwd,
    client: { name: params.client.name, version: params.client.version },
  }
}

/**
 * The process exit code for a response: success is 0, any error maps through the
 * shared error→exit table. This is the whole point of the exit-code contract —
 * an agent branches on the number, never on the message.
 */
export function exitCodeForResponse(response: ICLIResponse): number {
  return response.ok ? ExitSuccess : exitCodeForError(response.error.code)
}
