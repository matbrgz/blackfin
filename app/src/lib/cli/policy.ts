// The safety-control decision for a mutating CLI command (#65). This is the
// lock the issue is about, distilled to a single pure function: given what a
// command declares about itself (does it mutate, how does it confirm) and the
// user's current stance (is the mutation kill switch on, is there a per-command
// override), decide whether an agent may run it now, must ask a human first, or
// is refused outright.
//
// It is pure and total — no I/O, no clock, no throw. It returns a RESULT for
// every input, because a safety gate that can throw is a safety gate that can
// fail open. The dispatcher (a later increment) turns an `auto` into a `run`, a
// `confirm` into an enqueue + `needs-confirmation` (exit 6), and a `denied` into
// the error envelope carried here — but the *decision* lives here, alone, so it
// can be exhaustively tested without a socket, a store, or the app.

import type { CLIConfirmation } from './capabilities'
import type { CLIErrorCode } from './protocol'

/**
 * The user's per-command stance, set in Preferences → Agent CLI once mutations
 * are enabled. Deliberately three closed values, never free text:
 *
 * - `'ask'`   — always route through a human, even a command that could be auto.
 * - `'allow'` — run without asking. Honored only where the command's own
 *               `confirmation` permits it (never for an `'always'` command —
 *               there is no "remember this forever" for those, by design).
 * - `'never'` — refuse. The strictest choice always wins.
 */
export type CLICommandPolicy = 'ask' | 'allow' | 'never'

/**
 * The ambient stance the decision reads, passed in so the function stays pure.
 * `mutatingEnabled` is the kill switch, and it is born `false`: a user turns an
 * agent's power on deliberately, never by default.
 */
export interface IPolicyContext {
  /** The kill switch. When off, every command that mutates is refused. */
  readonly mutatingEnabled: boolean
  /** Per-command user overrides, keyed by command name. Absent ⇒ the command's own default. */
  readonly perCommand?: Readonly<Record<string, CLICommandPolicy>>
}

/**
 * The minimal shape the decision needs from a command. `ICommandDescriptor`
 * (registry.ts) is structurally assignable to it, so `resolvePolicy(descriptor,
 * ctx)` just works — while this file stays free of a dependency on the registry,
 * which would otherwise import it back and form a cycle.
 */
export interface IPolicyCommand {
  readonly name: string
  readonly mutates: boolean
  readonly confirmation: CLIConfirmation
}

/** Why a command was refused, distinct from the message so a test can assert on it. */
export type PolicyDenialReason = 'mutations-disabled' | 'policy-forbidden'

/**
 * The decision. Exactly three outcomes, and the dispatcher must handle each:
 *
 * - `auto`    — run it now, no human in the loop.
 * - `confirm` — do NOT run. Enqueue a confirmation card and answer
 *               `needs-confirmation` (exit 6). Only a human click runs it.
 * - `denied`  — refuse. Carries the error code (always exit 3, `unauthorized`)
 *               and the prose to hand the agent, whose hint tells it to stop and
 *               talk to the user rather than retry in a loop.
 */
export type IPolicyDecision =
  | { readonly kind: 'auto' }
  | { readonly kind: 'confirm' }
  | {
      readonly kind: 'denied'
      readonly reason: PolicyDenialReason
      readonly code: CLIErrorCode
      readonly message: string
      readonly hint: string
    }

function denied(
  reason: PolicyDenialReason,
  message: string,
  hint: string
): IPolicyDecision {
  // Every refusal is `unauthorized` → exit 3. The agent must read it as "stop,
  // this door is closed for you", never as a transient error worth retrying.
  return { kind: 'denied', reason, code: 'unauthorized', message, hint }
}

const DENIAL_HINT =
  'Do not retry. Tell the user what you were about to do and let them decide.'

function assertNever(value: never): never {
  throw new Error(`Unhandled confirmation policy: ${String(value)}`)
}

/**
 * Decide whether `command` may run under `context`. Pure, total, never throws.
 *
 * The order of the checks is the security model, and it is not rearrangeable:
 *
 *  1. A pure read (mutates: false, confirmation: 'none') is always safe. It is
 *     never gated — not by the kill switch, not by a per-command override — so
 *     turning off an agent's *power to change things* never turns off its
 *     ability to *see* them.
 *  2. The kill switch. A command that mutates while mutations are off is refused
 *     before anything else looks at it. This is the whole point of the switch.
 *  3. A per-command `'never'` refuses next: the strictest stance always wins,
 *     and it can veto even a command that would otherwise be auto.
 *  4. Finally, the command's declared `confirmation` decides between auto and
 *     confirm, with the per-command stance allowed only to move a decision in
 *     the safe direction (toward asking a human), never away from it.
 */
export function resolvePolicy(
  command: IPolicyCommand,
  context: IPolicyContext
): IPolicyDecision {
  // 1. Reading is always safe. The kill switch governs power, not perception.
  if (!command.mutates && command.confirmation === 'none') {
    return { kind: 'auto' }
  }

  // 2. The kill switch. Mutations are off until the user turns them on.
  if (command.mutates && !context.mutatingEnabled) {
    return denied(
      'mutations-disabled',
      'Blackfin is not accepting changes from agents. The user has to turn that on in Preferences → Agent CLI.',
      DENIAL_HINT
    )
  }

  const choice = context.perCommand?.[command.name]

  // 3. A per-command `'never'` is an absolute veto — stricter than the
  //    command's own default, so it applies even to an auto-tier command.
  if (choice === 'never') {
    return denied(
      'policy-forbidden',
      'The user has set this command to never run from an agent.',
      DENIAL_HINT
    )
  }

  // 4. The command's declared confirmation, adjustable only toward safety.
  switch (command.confirmation) {
    case 'always':
      // Never downgradeable to auto. An `'allow'` override is ignored here on
      // purpose: a command whose whole reason to exist is a human click cannot
      // be made silent, not even by the user, and never "for trusted sources".
      return { kind: 'confirm' }

    case 'policy':
      // User-governed (e.g. `show diff`). Default is to allow; `'ask'` upgrades
      // it to a confirmation. The rate limit that also guards it lives in the
      // dispatcher, not here — this is the run/ask/refuse decision only.
      return choice === 'ask' ? { kind: 'confirm' } : { kind: 'auto' }

    case 'none':
      // The auto-tier mutation exception (#64: `checkpoint set`). It runs
      // invisibly by default; a user who wants a human in the loop anyway can
      // still set `'ask'`.
      return choice === 'ask' ? { kind: 'confirm' } : { kind: 'auto' }

    default:
      return assertNever(command.confirmation)
  }
}
