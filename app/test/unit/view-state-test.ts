import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IViewStateInputs,
  StaleAfterMs,
  deriveViewState,
  emptyReasonFor,
  isScanned,
  isUnreadable,
  outcomeNeedsAttention,
  summarizeOutcomes,
  unreadableReason,
} from '../../src/models/view-state'
import { CleanupOutcome } from '../../src/lib/workspace/cleanup'
import { InventoryStatus } from '../../src/models/workspace-inventory'

function inputs(overrides: Partial<IViewStateInputs> = {}): IViewStateInputs {
  return {
    itemCount: 3,
    failedCount: 0,
    totalBeforeFilter: 3,
    filter: '',
    scanning: false,
    hasEverLoaded: true,
    cachedAt: null,
    now: 1_700_000_000_000,
    failureReason: null,
    ...overrides,
  }
}

describe('deriveViewState — precedence', () => {
  it('a hard failure wins over everything, even with content', () => {
    const state = deriveViewState(
      inputs({ failureReason: 'disk gone', itemCount: 5, scanning: true })
    )
    assert.deepStrictEqual(state, { kind: 'failed', reason: 'disk gone' })
  })

  it('never having looked is loading, even while a scan runs', () => {
    // There is no cache to keep on screen, so this is the skeleton case.
    const state = deriveViewState(
      inputs({ hasEverLoaded: false, scanning: true, itemCount: 0 })
    )
    assert.deepStrictEqual(state, { kind: 'loading' })
  })

  it('content plus a running scan is refreshing — content stays', () => {
    const state = deriveViewState(inputs({ itemCount: 4, scanning: true }))
    assert.deepStrictEqual(state, { kind: 'refreshing' })
  })

  it('refreshing outranks partial and stale when a scan is in flight', () => {
    const state = deriveViewState(
      inputs({
        itemCount: 4,
        scanning: true,
        failedCount: 2,
        cachedAt: 0,
      })
    )
    assert.equal(state.kind, 'refreshing')
  })

  it('content with some failures and no scan is partial', () => {
    const state = deriveViewState(inputs({ itemCount: 38, failedCount: 2 }))
    assert.deepStrictEqual(state, { kind: 'partial', ok: 38, failed: 2 })
  })

  it('content from a previous session is stale, carrying its timestamp', () => {
    const now = 1_700_000_000_000
    const cachedAt = now - StaleAfterMs
    const state = deriveViewState(inputs({ now, cachedAt }))
    assert.deepStrictEqual(state, { kind: 'stale', asOf: cachedAt })
  })

  it('content cached just now is ready, not stale', () => {
    const now = 1_700_000_000_000
    const state = deriveViewState(inputs({ now, cachedAt: now - 1000 }))
    assert.deepStrictEqual(state, { kind: 'ready' })
  })

  it('fresh, whole, scanned content is ready', () => {
    const state = deriveViewState(inputs())
    assert.deepStrictEqual(state, { kind: 'ready' })
  })

  it('partial outranks stale when both could apply', () => {
    const now = 1_700_000_000_000
    const state = deriveViewState(
      inputs({
        itemCount: 5,
        failedCount: 1,
        cachedAt: now - StaleAfterMs,
        now,
      })
    )
    assert.equal(state.kind, 'partial')
  })
})

describe('deriveViewState — the empty edge', () => {
  it('no content while still scanning is loading, not empty', () => {
    // An empty verdict before the scan finishes is a lie the next frame undoes.
    const state = deriveViewState(
      inputs({ itemCount: 0, scanning: true, totalBeforeFilter: 0 })
    )
    assert.deepStrictEqual(state, { kind: 'loading' })
  })

  it('read, no scan, nothing there is empty', () => {
    const state = deriveViewState(
      inputs({ itemCount: 0, totalBeforeFilter: 0 })
    )
    assert.equal(state.kind, 'empty')
  })
})

describe('emptyReasonFor — the three empties', () => {
  it('nothing ever added is never-started', () => {
    const reason = emptyReasonFor(
      inputs({ itemCount: 0, totalBeforeFilter: 0 })
    )
    assert.deepStrictEqual(reason, { kind: 'never-started' })
  })

  it('data exists but a filter hid it all is filtered', () => {
    const reason = emptyReasonFor(
      inputs({ itemCount: 0, totalBeforeFilter: 10, filter: 'zzz' })
    )
    assert.deepStrictEqual(reason, { kind: 'filtered', filter: 'zzz' })
  })

  it('read and genuinely nothing is the finding, not an error', () => {
    const reason = emptyReasonFor(
      inputs({ itemCount: 0, totalBeforeFilter: 5, filter: '' })
    )
    assert.deepStrictEqual(reason, { kind: 'truly-empty' })
  })

  it('a filter over zero items is never-started, not filtered', () => {
    // "No projects match" over nothing is a sentence about nothing.
    const reason = emptyReasonFor(
      inputs({ itemCount: 0, totalBeforeFilter: 0, filter: 'anything' })
    )
    assert.deepStrictEqual(reason, { kind: 'never-started' })
  })

  it('a whitespace-only filter does not count as filtering', () => {
    const reason = emptyReasonFor(
      inputs({ itemCount: 0, totalBeforeFilter: 5, filter: '   ' })
    )
    assert.deepStrictEqual(reason, { kind: 'truly-empty' })
  })
})

describe('per-item readability', () => {
  const missing: InventoryStatus = { kind: 'missing' }
  const error: InventoryStatus = { kind: 'error', message: 'permission denied' }
  const ok: InventoryStatus = { kind: 'ok' }
  const neverScanned: InventoryStatus = { kind: 'never-scanned' }

  it('missing and error are unreadable', () => {
    assert.equal(isUnreadable(missing), true)
    assert.equal(isUnreadable(error), true)
  })

  it('ok and never-scanned are not unreadable', () => {
    assert.equal(isUnreadable(ok), false)
    assert.equal(isUnreadable(neverScanned), false)
  })

  it('only ok counts as scanned — never-scanned must not read as empty', () => {
    assert.equal(isScanned(ok), true)
    assert.equal(isScanned(neverScanned), false)
    assert.equal(isScanned(missing), false)
  })

  it('gives a reason for unreadable projects and null for healthy ones', () => {
    assert.equal(unreadableReason(missing), 'This folder is no longer on disk.')
    assert.equal(unreadableReason(error), 'permission denied')
    assert.equal(unreadableReason(ok), null)
    assert.equal(unreadableReason(neverScanned), null)
  })
})

describe('summarizeOutcomes', () => {
  const outcomes: ReadonlyArray<CleanupOutcome> = [
    { kind: 'deleted', relativePath: 'a/node_modules' },
    { kind: 'deleted', relativePath: 'b/dist' },
    { kind: 'refused', relativePath: 'c/src', reason: 'no sibling manifest' },
    { kind: 'failed', relativePath: 'd/target', message: 'EBUSY' },
  ]

  it('tallies deleted, and keeps every refusal and failure with its reason', () => {
    const summary = summarizeOutcomes(outcomes)
    assert.equal(summary.deleted, 2)
    assert.deepStrictEqual(summary.refused, [
      { relativePath: 'c/src', reason: 'no sibling manifest' },
    ])
    assert.deepStrictEqual(summary.failed, [
      { relativePath: 'd/target', message: 'EBUSY' },
    ])
  })

  it('an empty run summarizes to all zeros', () => {
    assert.deepStrictEqual(summarizeOutcomes([]), {
      deleted: 0,
      refused: [],
      failed: [],
    })
  })
})

describe('outcomeNeedsAttention', () => {
  it('all deleted, nothing refused or failed is the quiet success case', () => {
    const summary = summarizeOutcomes([
      { kind: 'deleted', relativePath: 'a' },
      { kind: 'deleted', relativePath: 'b' },
    ])
    assert.equal(outcomeNeedsAttention(summary), false)
  })

  it('any refusal must be surfaced — that is why the channel exists', () => {
    const summary = summarizeOutcomes([
      { kind: 'deleted', relativePath: 'a' },
      { kind: 'refused', relativePath: 'b', reason: 'symlink' },
    ])
    assert.equal(outcomeNeedsAttention(summary), true)
  })

  it('any failure must be surfaced', () => {
    const summary = summarizeOutcomes([
      { kind: 'failed', relativePath: 'a', message: 'EPERM' },
    ])
    assert.equal(outcomeNeedsAttention(summary), true)
  })

  it('a wholly empty run needs no attention', () => {
    assert.equal(outcomeNeedsAttention(summarizeOutcomes([])), false)
  })
})
