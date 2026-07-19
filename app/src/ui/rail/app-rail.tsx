import * as React from 'react'
import classNames from 'classnames'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AppSection } from '../../models/app-section'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'

type Project = Repository | CloningRepository

/** The display name for a project: its alias when set, otherwise its name. */
function projectName(project: Project): string {
  return project instanceof Repository
    ? project.alias ?? project.name
    : project.name
}

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
  /** Every known project, for the scope selector. */
  readonly projects: ReadonlyArray<Project>
  /** The project the rail is scoped to, or `null` for all projects. */
  readonly scopedProject: Project | null
  /** Select a project to scope to, or `null` for all projects. */
  readonly onSelectScope: (project: Project | null) => void
}

interface IAppRailState {
  readonly scopeExpanded: boolean
}

/** The app's primary navigation. Always present, never scrolls away. */
export class AppRail extends React.Component<IAppRailProps, IAppRailState> {
  public constructor(props: IAppRailProps) {
    super(props)
    this.state = { scopeExpanded: false }
  }

  private onToggleScope = () => {
    this.setState({ scopeExpanded: !this.state.scopeExpanded })
  }

  private onPickScope = (project: Project | null) => {
    this.setState({ scopeExpanded: false })
    this.props.onSelectScope(project)
  }

  private renderScope() {
    const { projects, scopedProject } = this.props
    const { scopeExpanded } = this.state
    const label =
      scopedProject === null ? 'All projects' : projectName(scopedProject)

    return (
      <div className="app-rail-scope">
        <button
          className="app-rail-scope-toggle"
          onClick={this.onToggleScope}
          aria-expanded={scopeExpanded}
          aria-haspopup="menu"
          aria-label={`Project scope: ${label}`}
        >
          <Octicon
            className="app-rail-scope-chevron"
            symbol={
              scopeExpanded ? octicons.chevronDown : octicons.chevronRight
            }
          />
          <span className="app-rail-scope-label">{label}</span>
        </button>
        {scopeExpanded && (
          <ul className="app-rail-scope-menu" role="menu">
            <li role="none">
              <button
                role="menuitemradio"
                aria-checked={scopedProject === null}
                className={classNames('app-rail-scope-item', {
                  selected: scopedProject === null,
                })}
                onClick={this.onPickAll}
              >
                All projects
              </button>
            </li>
            {projects.map((project, i) => (
              <li role="none" key={i}>
                <button
                  role="menuitemradio"
                  aria-checked={project === scopedProject}
                  className={classNames('app-rail-scope-item', {
                    selected: project === scopedProject,
                  })}
                  onClick={this.onPickProject(project)}
                >
                  {projectName(project)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  private onPickAll = () => this.onPickScope(null)
  private onPickProject = (project: Project) => () => this.onPickScope(project)

  public render() {
    const { selectedSection, attentionCount, onSelectSection } = this.props

    return (
      <nav
        className={classNames('app-rail', {
          'scope-expanded': this.state.scopeExpanded,
        })}
        aria-label="Primary"
      >
        {this.renderScope()}
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
