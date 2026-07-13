import * as React from 'react'
import classNames from 'classnames'
import { HealthState } from './badge'

interface IStatusIndicatorProps {
  readonly state: HealthState

  /**
   * The text beside the dot. Defaults to a word for the state, because this
   * indicator is *never allowed to be colour alone* — a red dot and a green dot
   * are the same dot to a colour-blind reader, and the same nothing to a screen
   * reader. The label is the information; the dot only reinforces it.
   */
  readonly label?: string
}

const STATUS_LABEL: Record<HealthState, string> = {
  ok: 'Healthy',
  attention: 'Needs attention',
  broken: 'Broken',
  inherited: 'Inherited',
  overridden: 'Overridden',
  stale: 'Stale',
  unknown: 'Unknown',
}

/** The word for a state, used when no explicit label is given. Exported for tests. */
export function statusLabel(state: HealthState): string {
  return STATUS_LABEL[state]
}

/**
 * A coloured dot and a word, for the seven health states of #17.
 *
 * Deliberately not colour-only and deliberately not animated: there is no pulse
 * by default, and none is added under `prefers-reduced-motion`. A control
 * center that throbs teaches you to look away from it.
 */
export class StatusIndicator extends React.Component<IStatusIndicatorProps> {
  public render() {
    const { state } = this.props
    const label = this.props.label ?? STATUS_LABEL[state]

    return (
      <span
        className={classNames('status-indicator', `status-indicator--${state}`)}
      >
        <span className="status-indicator-dot" aria-hidden={true} />
        <span className="status-indicator-label">{label}</span>
      </span>
    )
  }
}
