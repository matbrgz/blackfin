// The state taxonomy for every data surface in the control center (#19),
// written once so no screen invents its own.
//
// This is the pure, testable core: a discriminated union and the deterministic
// functions that derive it from what the stores already produce
// (`IScanProgress`, `InventoryStatus`, `CleanupOutcome`). It renders nothing —
// #19's components (`<EmptyState>`, `<Skeleton>`, `<UnreadableRow>`,
// `<OutcomeSummary>`) consume these values; they do not recompute them.
//
// The whole point of doing this as a union rather than a pile of booleans is
// the failure the issue names: a screen that treats "refreshing" like "loading"
// blanks content that was already good, and a screen that treats "never
// scanned" like "empty" asserts a fact it never established. Making the states
// mutually exclusive and named is what stops both.
//
// Pure: no I/O, no throwing, deterministic.

import { InventoryStatus } from './workspace-inventory'
import { CleanupOutcome } from '../lib/workspace/cleanup'

/**
 * The state of one data surface. Every field a screen needs to render honestly
 * is on the variant, so a surface never has to consult a second source to know
 * what to draw.
 */
export type ViewState =
  /** First paint, no cache. Draw a skeleton shaped like the content — never a spinner. */
  | { readonly kind: 'loading' }
  /**
   * Cache is painted and a scan is in flight. The content STAYS, with a quiet
   * indicator. Never blank a screen that was already good — this is the whole
   * reason the union exists.
   */
  | { readonly kind: 'refreshing' }
  /** Cache from a previous session, not yet revalidated. Content, plus "as of <when>". */
  | { readonly kind: 'stale'; readonly asOf: number }
  /** Some items read, some failed. Content, plus an honest count. */
  | {
      readonly kind: 'partial'
      readonly ok: number
      readonly failed: number
    }
  /** Read, and there is nothing. Three distinct kinds — see `EmptyReason`. */
  | { readonly kind: 'empty'; readonly reason: EmptyReason }
  /** The whole operation failed. A reason, and a retry belongs next to it. */
  | { readonly kind: 'failed'; readonly reason: string }
  /** Read, and there is content to show. */
  | { readonly kind: 'ready' }

/**
 * The three empties. Conflating them is the bug the issue calls out
 * (`workspace-center.tsx`): each wants a different primary action, and one of
 * them is not an empty at all — it is the most valuable finding on the screen.
 */
export type EmptyReason =
  /** The user never added a folder. Onboarding — a primary "Add folder…" action. */
  | { readonly kind: 'never-started' }
  /** There is data; the filter excluded all of it. A "Clear filter" action. */
  | { readonly kind: 'filtered'; readonly filter: string }
  /**
   * Read, and genuinely nothing here. This is a FINDING, not an error:
   * "nothing steers any agent in this project" is information, and must read as
   * one. No retry, no alarm.
   */
  | { readonly kind: 'truly-empty' }

/**
 * Inputs to the surface-state decision. Every one is something a store already
 * has; nothing here is observed or fetched.
 */
export interface IViewStateInputs {
  /** Items that survived reading and are ready to show. */
  readonly itemCount: number
  /** Items that were found but could not be read. Drives `partial`. */
  readonly failedCount: number
  /** Total items the user has before any filter — distinguishes the three empties. */
  readonly totalBeforeFilter: number
  /** The active filter text, if any. Empty string means no filter. */
  readonly filter: string
  /** Is a scan in flight right now? */
  readonly scanning: boolean
  /** Has this surface ever been read? false ⇒ we have looked at nothing yet. */
  readonly hasEverLoaded: boolean
  /** When the shown data was produced, or null if it is fresh this session. */
  readonly cachedAt: number | null
  /** The session clock, so "is this stale" is a decision, not a `Date.now()`. */
  readonly now: number
  /** A surface-level failure (the operation itself threw), if any. */
  readonly failureReason: string | null
}

/**
 * The age past which cached data is labelled `stale` rather than shown silently.
 * A whole session is the unit: data from a previous run is worth a quiet mark,
 * data from ten seconds ago is not.
 */
export const StaleAfterMs = 12 * 60 * 60 * 1000

/**
 * Decide the one state a surface is in. The order of the checks is the
 * precedence, and it is deliberate:
 *
 *   1. A hard failure wins over everything — there is nothing trustworthy to show.
 *   2. Never having looked is `loading`, even if a scan is now running.
 *   3. Content present + scan running is `refreshing` — content stays.
 *   4. Content present + some failures is `partial`.
 *   5. Content present + old cache is `stale`.
 *   6. Content present, fresh, whole ⇒ `ready`.
 *   7. No content ⇒ one of the three empties, chosen by why.
 *
 * Pure; never throws.
 */
export function deriveViewState(inputs: IViewStateInputs): ViewState {
  if (inputs.failureReason !== null) {
    return { kind: 'failed', reason: inputs.failureReason }
  }

  // We have looked at nothing yet. A scan may be running, but there is no cache
  // to keep on screen, so this is the skeleton case, not the refreshing one.
  if (!inputs.hasEverLoaded) {
    return { kind: 'loading' }
  }

  if (inputs.itemCount > 0) {
    // Content is present. It stays on screen through every one of these; the
    // state only changes what decoration goes around it.
    if (inputs.scanning) {
      return { kind: 'refreshing' }
    }
    if (inputs.failedCount > 0) {
      return {
        kind: 'partial',
        ok: inputs.itemCount,
        failed: inputs.failedCount,
      }
    }
    if (
      inputs.cachedAt !== null &&
      inputs.now - inputs.cachedAt >= StaleAfterMs
    ) {
      return { kind: 'stale', asOf: inputs.cachedAt }
    }
    return { kind: 'ready' }
  }

  // No content. If a scan is still running and we have nothing yet, that is
  // still loading — an empty verdict before the scan finishes would be a lie
  // that the next frame contradicts.
  if (inputs.scanning) {
    return { kind: 'loading' }
  }

  return { kind: 'empty', reason: emptyReasonFor(inputs) }
}

/**
 * Which of the three empties applies. Separated out because the choice is the
 * subtle part and deserves its own tests.
 *
 *   - Nothing exists at all, ever ⇒ the user has not started.
 *   - Things exist but a filter hid them all ⇒ filtered.
 *   - Things were read and there are none ⇒ the finding.
 */
export function emptyReasonFor(inputs: IViewStateInputs): EmptyReason {
  const hasFilter = inputs.filter.trim().length > 0

  // A filter is only responsible for the empty if there was something for it to
  // exclude. "No projects match" over zero projects is a sentence about nothing.
  if (hasFilter && inputs.totalBeforeFilter > 0) {
    return { kind: 'filtered', filter: inputs.filter }
  }

  if (inputs.totalBeforeFilter === 0) {
    return { kind: 'never-started' }
  }

  return { kind: 'truly-empty' }
}

// ─────────────────────────────────────────────────────────────
// Per-item readability. A project that could not be read is a first-class
// citizen: it never vanishes and is never counted as "no context" (#19 item 3).
// ─────────────────────────────────────────────────────────────

/**
 * Whether an inventory status means the project itself could not be read — as
 * opposed to being read and found empty. The distinction is the whole point:
 * an unreadable project keeps its row and its reason; an empty one is a finding.
 */
export function isUnreadable(status: InventoryStatus): boolean {
  return status.kind === 'missing' || status.kind === 'error'
}

/**
 * Whether a status has actually been established by a scan. `never-scanned` is
 * neither readable nor unreadable — we have not looked — and must never be
 * counted as "no context". This is the guard against the bug where a project
 * full of skills renders identically to one with none because neither was read.
 */
export function isScanned(status: InventoryStatus): boolean {
  return status.kind === 'ok'
}

/**
 * The human reason a project could not be read, for its row. Returns null when
 * the project is not in an unreadable state, so a caller cannot accidentally
 * render a reason for a healthy project.
 */
export function unreadableReason(status: InventoryStatus): string | null {
  switch (status.kind) {
    case 'missing':
      return 'This folder is no longer on disk.'
    case 'error':
      return status.message
    case 'ok':
    case 'never-scanned':
      return null
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

// ─────────────────────────────────────────────────────────────
// The outcome channel (#19 item 4). A destructive operation whose refusals are
// silent is the smallest change here and the highest value — so the summary is
// modelled, not left to each caller to total up by hand.
// ─────────────────────────────────────────────────────────────

/** A tallied set of cleanup outcomes, ready for `<OutcomeSummary>` to render. */
export interface IOutcomeSummary {
  readonly deleted: number
  /** Refusals carry their reason — the paranoia of `cleanup.ts` made visible. */
  readonly refused: ReadonlyArray<{
    readonly relativePath: string
    readonly reason: string
  }>
  readonly failed: ReadonlyArray<{
    readonly relativePath: string
    readonly message: string
  }>
}

/**
 * Total a run of `CleanupOutcome`s into a summary. The exhaustive switch means a
 * new outcome kind cannot be added without deciding how it is reported here —
 * it breaks compilation rather than being silently dropped, which for a
 * destructive operation is exactly the safety we want. Pure; never throws.
 */
export function summarizeOutcomes(
  outcomes: ReadonlyArray<CleanupOutcome>
): IOutcomeSummary {
  let deleted = 0
  const refused: Array<{ relativePath: string; reason: string }> = []
  const failed: Array<{ relativePath: string; message: string }> = []

  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'deleted':
        deleted += 1
        break
      case 'refused':
        refused.push({
          relativePath: outcome.relativePath,
          reason: outcome.reason,
        })
        break
      case 'failed':
        failed.push({
          relativePath: outcome.relativePath,
          message: outcome.message,
        })
        break
      default: {
        const unhandled: never = outcome
        return unhandled
      }
    }
  }

  return { deleted, refused, failed }
}

/**
 * Whether a summary is worth surfacing at all. Everything deleted and nothing
 * refused or failed is the quiet success case; a caller can skip the summary.
 * Any refusal or failure must be shown — that is the entire reason this channel
 * exists.
 */
export function outcomeNeedsAttention(summary: IOutcomeSummary): boolean {
  return summary.refused.length > 0 || summary.failed.length > 0
}
