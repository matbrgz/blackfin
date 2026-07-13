import * as React from 'react'
import classNames from 'classnames'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/**
 * The one vocabulary of badges the product speaks. Before this, four screens
 * each grew their own `<span className="…-badge">`, and "inherited" looked like
 * a different fact in each. A badge is a small, bounded claim about one thing;
 * `kind` says which register of claim it is.
 */
export type BadgeKind =
  | 'agent'
  | 'scope'
  | 'role'
  | 'trust'
  | 'count'
  | 'health'

/** The seven states of #17's health scale. Shared with `StatusIndicator`. */
export type HealthState =
  | 'ok'
  | 'attention'
  | 'broken'
  | 'inherited'
  | 'overridden'
  | 'stale'
  | 'unknown'

/**
 * How much a thing detected on disk is trusted to run.
 *
 * `unverified` is the default and the *safe* default: a plugin is not trusted
 * code until something says it is, so the absence of a trust claim must read as
 * "we have not verified this", never as silence and never as "fine". A badge
 * that erred the other way would be a vulnerability rendered in CSS.
 */
export type TrustLevel = 'unverified' | 'verified' | 'official'

/** Where a rule reaching a project comes from. */
export type ScopeValue = 'global' | 'project'

interface IBadgeProps {
  readonly kind: BadgeKind

  /** The visible text. Optional only when the badge is icon-only. */
  readonly label?: string

  /** An optional leading icon. */
  readonly icon?: OcticonSymbol

  /**
   * The accessible name. Required when there is no visible `label`, and the
   * substitute for `title`, which is banned. An icon-only badge with neither a
   * label nor this does not render — a coloured dot with no name is not
   * information, it is decoration pretending to be information.
   */
  readonly ariaLabel?: string

  /** For `kind="health"`: which of the seven states. */
  readonly health?: HealthState

  /**
   * For `kind="trust"`: how trusted. Absent means `unverified` — the safe
   * default is the *absence* of a claim, not a separate "please set me" value.
   */
  readonly trust?: TrustLevel

  /** For `kind="scope"`: global or project. */
  readonly scope?: ScopeValue
}

interface IResolvedBadge {
  /** Which health-token family paints it. */
  readonly tone: HealthState
  /** The text to show, if any. */
  readonly text: string | undefined
  /** The icon to show, if any. */
  readonly icon: OcticonSymbol | undefined
}

const TRUST_TEXT: Record<TrustLevel, string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  official: 'Official',
}

const TRUST_TONE: Record<TrustLevel, HealthState> = {
  // Not alarming, but never quiet: an unverified thing must be *seen* to be
  // unverified, so it borrows the one loud-but-not-broken state.
  unverified: 'attention',
  verified: 'ok',
  official: 'inherited',
}

const TRUST_ICON: Record<TrustLevel, OcticonSymbol> = {
  unverified: octicons.unverified,
  verified: octicons.verified,
  official: octicons.shieldCheck,
}

/**
 * The safe reading of a trust prop. Its own function, and exported, because the
 * default-to-`unverified` rule is a security invariant and a test guards it: a
 * `kind="trust"` badge with no prop must resolve to `unverified`, never to
 * anything that reads as trusted.
 */
export function trustLevel(trust: TrustLevel | undefined): TrustLevel {
  return trust ?? 'unverified'
}

/** Resolve props to the concrete tone, text and icon the badge renders. */
export function resolveBadge(props: IBadgeProps): IResolvedBadge {
  switch (props.kind) {
    case 'trust': {
      const level = trustLevel(props.trust)
      return {
        tone: TRUST_TONE[level],
        text: props.label ?? TRUST_TEXT[level],
        icon: props.icon ?? TRUST_ICON[level],
      }
    }
    case 'scope':
      return {
        // A global rule reaching into a project is exactly "inherited"; a
        // project-local one is neutral, because it is simply where you are.
        tone: props.scope === 'global' ? 'inherited' : 'ok',
        text: props.label,
        icon:
          props.icon ??
          (props.scope === 'global' ? octicons.globe : octicons.repoClone),
      }
    case 'health':
      return {
        tone: props.health ?? 'unknown',
        text: props.label,
        icon: props.icon,
      }
    case 'agent':
    case 'role':
    case 'count':
      return { tone: 'unknown', text: props.label, icon: props.icon }
  }
}

/**
 * The accessible name a badge would expose, or `undefined` if it has none.
 *
 * A visible label is its own accessible name; otherwise `ariaLabel` is. When
 * both are absent the badge is not renderable — this function returning
 * `undefined` is the component's cue to render nothing rather than emit an
 * unnamed icon. Exported so a test can assert the rule without the DOM.
 */
export function badgeAccessibleName(props: IBadgeProps): string | undefined {
  const resolved = resolveBadge(props)
  return resolved.text ?? props.ariaLabel
}

/**
 * A small, bounded, read-only claim about one thing — an agent, a scope, a
 * role, a trust level, a count, a health state. Renders plain text only; the
 * label is never treated as markup, because badge labels routinely carry
 * third-party strings (skill names, frontmatter) and a badge is not where you
 * decide something is safe to interpret.
 */
export class Badge extends React.Component<IBadgeProps> {
  public render() {
    // Destructured so every prop is read here, not only inside `resolveBadge` —
    // both for the reader and for `react/no-unused-prop-types`, which cannot see
    // through the helper.
    const { kind, label, icon, ariaLabel, health, trust, scope } = this.props
    const resolved = resolveBadge({ kind, label, icon, health, trust, scope })
    const accessibleName = resolved.text ?? ariaLabel

    // No visible text and no accessible name: an unnamed badge is not
    // information. Refuse rather than ship a decorative coloured dot that a
    // screen reader will read as nothing.
    if (accessibleName === undefined) {
      return null
    }

    const iconOnly = resolved.text === undefined

    return (
      <span
        className={classNames(
          'badge',
          `badge--${kind}`,
          `badge--tone-${resolved.tone}`,
          { 'badge--icon-only': iconOnly }
        )}
        // An icon-only badge is, semantically, an image with a name; the text
        // badge is a plain generic span carrying visible text.
        role={iconOnly ? 'img' : undefined}
        aria-label={iconOnly ? accessibleName : undefined}
      >
        {resolved.icon !== undefined && (
          <Octicon symbol={resolved.icon} className="badge-icon" />
        )}
        {resolved.text !== undefined && (
          <span className="badge-text">{resolved.text}</span>
        )}
      </span>
    )
  }
}
