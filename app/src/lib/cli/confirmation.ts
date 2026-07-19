// The confirmation request an agent's mutating command produces when the policy
// decision (policy.ts) is `confirm` (#65). Pure: the shapes here carry no
// behavior and no I/O; the store that enqueues them and the dialog that renders
// them are later increments. Isolating the contract here is what lets the one
// security-critical rule about it — that not a single byte of the request's
// human-facing text may come from the agent — be stated and tested in one place.
//
// The defense this file encodes is subtle and worth saying plainly: the agent
// controls the `subject` (the URL it passed), and NOTHING else the human reads.
// Every `IConfirmationEffect.description` is written by Blackfin from its own
// inspection of the target — never interpolated with a string the agent sent.
// There is deliberately no `reason`, `message`, or `note` field for the agent to
// fill, because such a field would be the most obvious prompt-injection surface
// in the product: the agent would write both the request and the justification
// that convinces the user to approve it.

/** How severe an effect is, so the card can weight it — Blackfin's judgement, not the agent's. */
export type ConfirmationSeverity = 'info' | 'warning' | 'danger'

/**
 * One thing the command would do, described by Blackfin. The `description` is
 * authored by us from inspecting the (validated) target; it never quotes the
 * agent. "Downloads code from a third-party Git repository" is written here, not
 * received on the wire.
 */
export interface IConfirmationEffect {
  readonly description: string
  readonly severity: ConfirmationSeverity
}

/**
 * A pending request for a human decision. The only field that carries agent-
 * originated data is `subject` — the validated argument (a URL, an id) — and it
 * is shown verbatim and unmistakably as such. `claimedAgent` is what the process
 * *said* it was; it is not verifiable, and the card labels it that way.
 */
export interface IConfirmationRequest {
  readonly id: string
  readonly command: string
  /** The validated argument. The ONLY agent-originated datum shown to the human. */
  readonly subject: string
  readonly effects: ReadonlyArray<IConfirmationEffect>
  readonly requestedAt: number
  readonly expiresAt: number
  /** What the process claimed to be (e.g. "claude-code"). Not verifiable. */
  readonly claimedAgent: string | null
  readonly cwd: string
}

/**
 * How long a request stands before it lapses. A request not answered in this
 * window is REFUSED, never approved — see `isConfirmationExpired`.
 */
export const ConfirmationTtlMs = 5 * 60 * 1000

/**
 * Whether a request has lapsed at time `now`. Pure. The caller treats a lapsed
 * request as a refusal — silence is never consent, and a confirmation is never
 * approved by the passage of time. `now >= expiresAt` (not `>`) so the exact
 * expiry instant already counts as expired.
 */
export function isConfirmationExpired(
  request: Pick<IConfirmationRequest, 'expiresAt'>,
  now: number
): boolean {
  return now >= request.expiresAt
}
