import * as React from 'react'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AppSection } from '../../models/app-section'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { SectionFilterList } from '../lib/section-filter-list'
import { IFilterListItem, IFilterListGroup } from '../lib/filter-list'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { ClickSource } from '../lib/list'

type Project = Repository | CloningRepository

/** The display name for a project: its alias when set, otherwise its name. */
function projectName(project: Project): string {
  return project instanceof Repository
    ? project.alias ?? project.name
    : project.name
}

/** Sentinel id for the special "All projects" scope item. */
const AllProjectsItemId = '__all_projects__'

/** Height of a single scope row in the popover, in pixels. */
const ScopeRowHeight = 32

/** A scope choice in the popover: the "All projects" item, or one project. */
interface IScopeItem extends IFilterListItem {
  /** A unique identifier for the item. */
  readonly id: string
  /** The text used for filtering (the project display name). */
  readonly text: ReadonlyArray<string>
  /** The project this item scopes to, or `null` for "All projects". */
  readonly project: Project | null
}

/** A stable id for a scope item derived from its project. */
function scopeItemId(project: Project): string {
  return project instanceof Repository
    ? `repository-${project.id}`
    : `cloning-${project.id}`
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
  /** The current filter text in the scope popover. */
  readonly scopeFilterText: string
}

/** The app's primary navigation. Always present, never scrolls away. */
export class AppRail extends React.Component<IAppRailProps, IAppRailState> {
  private readonly scopeRef = React.createRef<HTMLDivElement>()

  /** The scope items ("All projects" + one per project) in a single group. */
  private getScopeItems = memoizeOne(
    (projects: ReadonlyArray<Project>): ReadonlyArray<IScopeItem> => [
      { id: AllProjectsItemId, text: ['All projects'], project: null },
      ...projects.map(project => ({
        id: scopeItemId(project),
        text: [projectName(project)],
        project,
      })),
    ]
  )

  private getScopeGroups = memoizeOne(
    (
      items: ReadonlyArray<IScopeItem>
    ): ReadonlyArray<IFilterListGroup<IScopeItem>> => [
      { identifier: 'projects', showHeader: false, items },
    ]
  )

  public constructor(props: IAppRailProps) {
    super(props)
    this.state = { scopeExpanded: false, scopeFilterText: '' }
  }

  private getSelectedScopeItem(
    items: ReadonlyArray<IScopeItem>,
    scopedProject: Project | null
  ): IScopeItem | null {
    return items.find(item => item.project === scopedProject) ?? null
  }

  public componentDidUpdate(
    prevProps: IAppRailProps,
    prevState: IAppRailState
  ) {
    // Listen for a dismiss only while the menu is open, so the rail adds no
    // document-level listeners in its resting state.
    if (this.state.scopeExpanded && !prevState.scopeExpanded) {
      document.addEventListener('mousedown', this.onDocumentMouseDown)
      document.addEventListener('keydown', this.onDocumentKeyDown)
    } else if (!this.state.scopeExpanded && prevState.scopeExpanded) {
      this.removeDismissListeners()
    }
  }

  public componentWillUnmount() {
    this.removeDismissListeners()
  }

  private removeDismissListeners() {
    document.removeEventListener('mousedown', this.onDocumentMouseDown)
    document.removeEventListener('keydown', this.onDocumentKeyDown)
  }

  private onDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target
    if (
      this.scopeRef.current !== null &&
      target instanceof Node &&
      !this.scopeRef.current.contains(target)
    ) {
      this.setState({ scopeExpanded: false })
    }
  }

  private onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.setState({ scopeExpanded: false })
    }
  }

  private onToggleScope = () => {
    this.setState(prevState => ({
      scopeExpanded: !prevState.scopeExpanded,
      scopeFilterText: '',
    }))
  }

  private onPickScope = (project: Project | null) => {
    this.setState({ scopeExpanded: false, scopeFilterText: '' })
    this.props.onSelectScope(project)
  }

  private onScopeItemClick = (item: IScopeItem, _source: ClickSource) => {
    this.onPickScope(item.project)
  }

  private onScopeFilterTextChanged = (text: string) => {
    this.setState({ scopeFilterText: text })
  }

  private onScopeFilterKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.setState({ scopeExpanded: false, scopeFilterText: '' })
    }
  }

  private renderScopeItem = (item: IScopeItem, matches: IMatches) => {
    const selected = item.project === this.props.scopedProject

    return (
      <div className={classNames('app-rail-scope-item', { selected })}>
        <span className="app-rail-scope-item-name">
          <HighlightText text={item.text[0]} highlight={matches.title} />
        </span>
        {selected && (
          <Octicon
            className="app-rail-scope-item-check"
            symbol={octicons.check}
          />
        )}
      </div>
    )
  }

  private renderScope() {
    const { projects, scopedProject } = this.props
    const { scopeExpanded, scopeFilterText } = this.state
    const label =
      scopedProject === null ? 'All projects' : projectName(scopedProject)
    const items = this.getScopeItems(projects)

    return (
      <div className="app-rail-scope" ref={this.scopeRef}>
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
          <div className="app-rail-scope-menu">
            <SectionFilterList<IScopeItem>
              className="app-rail-scope-list"
              rowHeight={ScopeRowHeight}
              groups={this.getScopeGroups(items)}
              selectedItem={this.getSelectedScopeItem(items, scopedProject)}
              renderItem={this.renderScopeItem}
              onItemClick={this.onScopeItemClick}
              filterText={scopeFilterText}
              onFilterTextChanged={this.onScopeFilterTextChanged}
              onFilterKeyDown={this.onScopeFilterKeyDown}
              invalidationProps={items}
              placeholderText="Filter projects"
            />
          </div>
        )}
      </div>
    )
  }

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
