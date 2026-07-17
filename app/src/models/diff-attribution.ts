import { IDiffAnchor } from '../lib/diff/diff-anchor'

// AI attribution: the honest data model (#70).
//
// Blackfin records the authorship an agent *declares* — it never infers it. The
// governing rule of the whole feature is structural, not a convention: there is
// no `'human'` state anywhere in this model, so no code path can ever fabricate
// the claim that a person wrote a line. Blackfin knows what an agent claimed and
// what no agent claimed; it does not know, and does not pretend to know, who
// wrote the rest.
//
// This module is pure types + a small set of pure, total helpers. The range
// algebra (shift/merge/split under edits) lives next to the anchors, in
// `lib/diff/attribution-range.ts`.

/**
 * The attribution of a single line.
 *
 * There is deliberately no `'human'` member. A line an agent did not claim is
 * `'unknown'`, never "written by you". That distinction is the difference
 * between a datum and a guess, and it is enforced by the type, not by discipline.
 */
export type AttributionState = 'agent' | 'unknown'

/** Why a line is `'unknown'`. The reasons are distinct and a user must tell them apart. */
export type AttributionUnknownReason =
  /**
   * No agent claimed this line. It may have been the user; it may have been an
   * agent that never ran the CLI. Blackfin does not know.
   */
  | 'unclaimed'
  /** An agent claimed it, but the content changed afterwards. The claim fell. */
  | 'claim-superseded'
  /** There is NO declaration at all for this file. Requires the header notice. */
  | 'no-data'

/** Who declared a claim, and when. Self-declared: a claim, never a verified fact. */
export interface IAttributionProvenance {
  /** Self-declared by the agent. Displayed as "Claimed by X", never "Written by X". */
  readonly agentId: string
  /** Groups the declarations of one unit of work. */
  readonly sessionId: string
  /** Epoch milliseconds the declaration was recorded. */
  readonly recordedAt: number
}

/**
 * A contiguous run of agent-authored lines, 1-indexed and inclusive on both ends,
 * carrying the provenance of the claim. Ranges only ever address lines an agent
 * claimed — an `'unknown'` line is the absence of a covering range, never a range
 * of its own.
 */
export interface IAttributionRange {
  /** First claimed line, 1-indexed, inclusive. */
  readonly start: number
  /** Last claimed line, 1-indexed, inclusive. `end >= start` always holds. */
  readonly end: number
  readonly provenance: IAttributionProvenance
}

/**
 * The attribution of a line, resolved for rendering. The `'agent'` arm carries
 * the provenance so the gutter can reveal it on hover; the `'unknown'` arm
 * carries only a reason, because there is nothing else honest to say.
 */
export type LineAttribution =
  | {
      readonly state: 'agent'
      readonly agentId: string
      readonly sessionId: string
      readonly recordedAt: number
      /** true when the anchor resolved via the `shifted` tier (content only). */
      readonly lowConfidence: boolean
    }
  | {
      readonly state: 'unknown'
      readonly reason: AttributionUnknownReason
    }

/**
 * The attribution state of a whole FILE — this is what decides the header notice.
 * `hasAnyData: false` MUST render "No attribution data", never a silent gutter,
 * because a diff with no marks reads as "no agent wrote any of this", which is a
 * claim Blackfin cannot make.
 */
export interface IFileAttributionSummary {
  /** false -> render "No attribution data". Never a mute gutter. */
  readonly hasAnyData: boolean
  readonly claimedLineCount: number
  readonly supersededLineCount: number
  readonly agents: ReadonlyArray<string>
}

/**
 * A claim persisted as one stable anchor per line (the #67 anchors, the same the
 * annotations use). The anchor — never a `diffLineNumber` — is what survives a
 * re-diff and lets a claim be re-checked against the current content.
 */
export interface IAttributionClaimLine {
  readonly anchor: IDiffAnchor
  readonly provenance: IAttributionProvenance
}

/** The canonical `'unknown'` attribution for a given reason. */
export function unknownAttribution(
  reason: AttributionUnknownReason
): LineAttribution {
  return { state: 'unknown', reason }
}

/** The `'agent'` attribution for a claim's provenance. */
export function agentAttribution(
  provenance: IAttributionProvenance,
  lowConfidence: boolean
): LineAttribution {
  return {
    state: 'agent',
    agentId: provenance.agentId,
    sessionId: provenance.sessionId,
    recordedAt: provenance.recordedAt,
    lowConfidence,
  }
}
