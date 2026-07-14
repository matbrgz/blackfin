import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as octicons from '../../src/ui/octicons/octicons.generated'
import {
  badgeAccessibleName,
  resolveBadge,
  trustLevel,
} from '../../src/ui/lib/badge'

describe('trust badge default', () => {
  // The security invariant of the whole component. A trust badge with no claim
  // must read as "we have not verified this" — never as anything trusted.
  it('resolves an absent trust prop to unverified', () => {
    assert.strictEqual(trustLevel(undefined), 'unverified')
  })

  it('renders "Unverified" for a trust badge with no prop', () => {
    const resolved = resolveBadge({ kind: 'trust' })
    assert.strictEqual(resolved.text, 'Unverified')
  })

  it('never renders a no-prop trust badge as trusted', () => {
    const resolved = resolveBadge({ kind: 'trust' })
    assert.notStrictEqual(resolved.text, 'Verified')
    assert.notStrictEqual(resolved.text, 'Official')
    // Its tone is the loud-but-not-broken one, so unverified is *seen*, not quiet.
    assert.strictEqual(resolved.tone, 'attention')
  })

  it('honours an explicit trust level when one is given', () => {
    assert.strictEqual(
      resolveBadge({ kind: 'trust', trust: 'verified' }).text,
      'Verified'
    )
    assert.strictEqual(
      resolveBadge({ kind: 'trust', trust: 'official' }).text,
      'Official'
    )
  })
})

describe('badge accessible name', () => {
  // An icon-only badge with no name is decoration pretending to be information;
  // the component refuses to render it, and this is the cue it keys on.
  it('is undefined for an icon-only badge with no label or ariaLabel', () => {
    assert.strictEqual(
      badgeAccessibleName({ kind: 'agent', icon: octicons.person }),
      undefined
    )
  })

  it('is the ariaLabel when there is an icon but no visible label', () => {
    assert.strictEqual(
      badgeAccessibleName({
        kind: 'agent',
        icon: octicons.person,
        ariaLabel: 'Claude',
      }),
      'Claude'
    )
  })

  it('is the visible label when there is one', () => {
    assert.strictEqual(
      badgeAccessibleName({ kind: 'count', label: '12 docs' }),
      '12 docs'
    )
  })

  // A trust badge is always named, because it always has default text — so it is
  // never the unnamed-icon case, even with only an icon.
  it('is always present for a trust badge', () => {
    assert.strictEqual(
      badgeAccessibleName({ kind: 'trust', icon: octicons.unverified }),
      'Unverified'
    )
  })
})
