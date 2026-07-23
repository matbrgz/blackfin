import { AgentId } from '../../models/workspace-inventory'
import { CapabilityKind, ExtensionSource } from '../../models/extension'

/**
 * Organisational policy: allowlists and blocking (#53).
 *
 * This is the PURE engine that decides whether an org's rules permit an item.
 * It is the source of the `policyBlock` reason `install-plan.ts` (#50) turns into
 * a first-class `blocked-by-policy` refusal. It performs NO I/O — the policy is
 * passed in as data; loading it (from disk / MDM / config) and the admin UI are
 * the runtime follow-up.
 *
 * A permitted item is NOT a safe item. `allowed` means "an org rule permits it",
 * never a safety assertion — Blackfin has no basis to claim safety and does not
 * (RFC #12, ratified: policy/allowlist is policy, never a safety claim).
 */

/** The identity a policy is evaluated against — the matchable subset of a candidate. */
export interface IPolicySubject {
  readonly name: string
  readonly kind: CapabilityKind
  readonly agent: AgentId
  readonly source: ExtensionSource
  /** The git remote, URL, or marketplace id. Carries the item's origin. */
  readonly sourceRef: string | null
}

/**
 * One rule. It matches a subject only when EVERY field the rule specifies
 * (non-null) matches the subject — an all-of conjunction, so a rule is as
 * specific as the admin makes it. All matching is by EQUALITY (or, for `host`,
 * equality of the parsed host), never substring: substring-matching a URL host
 * is exploitable and is the CodeQL `incomplete-url-substring-sanitization` bug.
 */
export interface IPolicyRule {
  readonly id: string
  /** Exact item name. */
  readonly name?: string | null
  readonly source?: ExtensionSource | null
  /** Exact `sourceRef` (git remote / marketplace id / URL). */
  readonly sourceRef?: string | null
  /** The parsed host of the subject's `sourceRef`, matched by equality. */
  readonly host?: string | null
  readonly kind?: CapabilityKind | null
  readonly agent?: AgentId | null
}

export enum PolicyMode {
  /** Default-DENY: only items matching an allow rule are permitted. */
  Allowlist = 'allowlist',
  /** Default-ALLOW: only items matching a block rule are denied. */
  Blocklist = 'blocklist',
}

/**
 * An org policy. `mode` decides the default for an unmatched item, and the two
 * lists are kept apart on purpose — conflating allow-by-default with
 * deny-by-default is the classic policy bug.
 */
export interface IOrgPolicy {
  readonly mode: PolicyMode
  readonly allow: ReadonlyArray<IPolicyRule>
  readonly block: ReadonlyArray<IPolicyRule>
}

/** A machine-readable reason an item is blocked by policy. */
export type PolicyBlockReason = 'blocklisted' | 'not-on-allowlist'

export type PolicyDecision =
  | { readonly kind: 'allowed' }
  | {
      readonly kind: 'blocked'
      readonly reason: PolicyBlockReason
      /** The rule that blocked it, or `null` for a default-deny with no match. */
      readonly ruleId: string | null
    }

/**
 * The host of a `sourceRef`, or `null` when it has none / cannot be parsed.
 * Handles `http(s)`/`ssh` URLs via `new URL` and scp-like git remotes
 * (`git@host:path`). Pure; never throws. Returns a host for EQUALITY comparison
 * only — the raw ref is never substring-searched.
 */
function hostOf(sourceRef: string | null): string | null {
  if (sourceRef === null || sourceRef.length === 0) {
    return null
  }
  const scp = /^[^/@]+@([^:/]+):/.exec(sourceRef)
  if (scp !== null) {
    return scp[1]
  }
  try {
    return new URL(sourceRef).hostname || null
  } catch {
    return null
  }
}

function ruleMatches(rule: IPolicyRule, subject: IPolicySubject): boolean {
  if (rule.name != null && rule.name !== subject.name) {
    return false
  }
  if (rule.source != null && rule.source !== subject.source) {
    return false
  }
  if (rule.sourceRef != null && rule.sourceRef !== subject.sourceRef) {
    return false
  }
  if (rule.host != null && rule.host !== hostOf(subject.sourceRef)) {
    return false
  }
  if (rule.kind != null && rule.kind !== subject.kind) {
    return false
  }
  if (rule.agent != null && rule.agent !== subject.agent) {
    return false
  }
  // A rule with no criteria at all matches nothing — it is a config mistake, not
  // a match-everything wildcard, which would be a dangerous silent default.
  const hasCriterion =
    rule.name != null ||
    rule.source != null ||
    rule.sourceRef != null ||
    rule.host != null ||
    rule.kind != null ||
    rule.agent != null
  return hasCriterion
}

/**
 * Evaluate an item against an org policy. Pure; never throws.
 *
 * Precedence, in order:
 *   1. An explicit BLOCK always wins — if any block rule matches, the item is
 *      blocked, regardless of mode or any allow rule.
 *   2. In `Allowlist` mode, an item is permitted only if an allow rule matches;
 *      otherwise it is blocked `not-on-allowlist`. An allowlist with no entries
 *      therefore permits NOTHING — a strict, intentional default the admin chose.
 *   3. In `Blocklist` mode, anything not blocked in step 1 is allowed. An empty
 *      blocklist therefore permits everything — the default-allow default.
 */
export function evaluatePolicy(
  subject: IPolicySubject,
  policy: IOrgPolicy
): PolicyDecision {
  const blocking = policy.block.find(rule => ruleMatches(rule, subject))
  if (blocking !== undefined) {
    return { kind: 'blocked', reason: 'blocklisted', ruleId: blocking.id }
  }

  if (policy.mode === PolicyMode.Allowlist) {
    const allowing = policy.allow.find(rule => ruleMatches(rule, subject))
    if (allowing === undefined) {
      return { kind: 'blocked', reason: 'not-on-allowlist', ruleId: null }
    }
  }

  return { kind: 'allowed' }
}

/**
 * The `policyBlock` string `install-plan.ts` (#50) expects: the block reason when
 * the policy forbids the item, or `null` when it permits it. Pluggable straight
 * into `decideInstall`'s `policyBlock` field.
 */
export function policyBlockFor(
  subject: IPolicySubject,
  policy: IOrgPolicy
): string | null {
  const decision = evaluatePolicy(subject, policy)
  return decision.kind === 'blocked' ? decision.reason : null
}
