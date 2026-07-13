import * as React from 'react'
import classNames from 'classnames'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AppSection } from '../../models/app-section'

interface IRailDestination {
  readonly section: AppSection
  readonly label: string
  readonly icon: OcticonSymbol
}

/**
 * `Code` sits second, not first. The app opens on Home, and the git client is
 * one destination among several — which is the entire argument this component
 * exists to make.
 */
const Destinations: ReadonlyArray<IRailDestination> = [
  { section: AppSection.Home, label: 'Home', icon: octicons.home },
  { section: AppSection.Code, label: 'Code', icon: octicons.gitBranch },
  { section: AppSection.Agents, label: 'Agents', icon: octicons.sparkleFill },
  { section: AppSection.Docs, label: 'Docs', icon: octicons.book },
  { section: AppSection.Disk, label: 'Disk', icon: octicons.database },
]

interface IAppRailItemProps {
  readonly destination: IRailDestination
  readonly selected: boolean
  readonly badge: number | null
  readonly onSelect: (section: AppSection) => void
}

class AppRailItem extends React.Component<IAppRailItemProps> {
  private onClick = () => {
    this.props.onSelect(this.props.destination.section)
  }

  public render() {
    const { destination, selected, badge } = this.props

    return (
      <button
        className={classNames('app-rail-item', { selected })}
        onClick={this.onClick}
        aria-current={selected ? 'page' : undefined}
      >
        <span className="app-rail-icon">
          <Octicon symbol={destination.icon} />
          {badge !== null && (
            <span className="app-rail-badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </span>
        <span className="app-rail-label">{destination.label}</span>
      </button>
    )
  }
}

interface IAppRailProps {
  readonly selectedSection: AppSection
  readonly onSelectSection: (section: AppSection) => void
  /** Shown as a badge on Home when projects need attention. */
  readonly attentionCount: number
}

/** The app's primary navigation. Always present, never scrolls away. */
export class AppRail extends React.Component<IAppRailProps> {
  public render() {
    const { selectedSection, attentionCount, onSelectSection } = this.props

    return (
      <nav className="app-rail" aria-label="Primary">
        {Destinations.map(destination => (
          <AppRailItem
            key={destination.section}
            destination={destination}
            selected={selectedSection === destination.section}
            badge={
              destination.section === AppSection.Home && attentionCount > 0
                ? attentionCount
                : null
            }
            onSelect={onSelectSection}
          />
        ))}
      </nav>
    )
  }
}
