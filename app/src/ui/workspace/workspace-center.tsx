import * as React from 'react'
import classNames from 'classnames'
import { UiView } from '../ui-view'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import { AppSection } from '../../models/app-section'
import {
  ContextScope,
  IGlobalContext,
  IRepositoryInventory,
  reclaimableBytes,
} from '../../models/workspace-inventory'
import { IScanProgress } from '../../lib/stores/workspace-store'
import { RepositoryRow } from './repository-row'
import { GlobalContextPanel } from './global-context-panel'
import { scopeDisplayName, sectionSubtitle, sectionTitle } from './display'

interface IWorkspaceCenterProps {
  readonly section: AppSection
  readonly repositories: ReadonlyArray<Repository>
  readonly inventories: ReadonlyMap<number, IRepositoryInventory>
  readonly globalContext: IGlobalContext
  readonly progress: IScanProgress
  readonly onRescan: () => void
  readonly onCleanUp: (
    repository: Repository,
    relativePaths: ReadonlyArray<string>
  ) => void
  readonly onOpenFile: (repository: Repository, relativePath: string) => void
  readonly onOpenPath: (absolutePath: string) => void
}

interface IWorkspaceCenterState {
  readonly scope: ContextScope
  readonly filter: string
  readonly expanded: ReadonlySet<number>
}

/**
 * The cross-project workspace. A shell: it owns the header, the scope tabs and
 * the filter, and delegates everything it actually renders.
 */
export class WorkspaceCenter extends React.Component<
  IWorkspaceCenterProps,
  IWorkspaceCenterState
> {
  public constructor(props: IWorkspaceCenterProps) {
    super(props)
    this.state = {
      scope: ContextScope.Project,
      filter: '',
      expanded: new Set(),
    }
  }

  public render() {
    const showsScope = this.props.section === AppSection.Agents

    return (
      <UiView id="workspace-center">
        {this.renderHeader()}
        {showsScope && this.renderScopeTabs()}
        <div className="workspace-list">
          {showsScope && this.state.scope === ContextScope.Global
            ? this.renderGlobal()
            : this.renderRepositories()}
        </div>
      </UiView>
    )
  }

  private onFilterChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ filter: event.currentTarget.value })
  }

  private onSelectGlobal = () => this.setState({ scope: ContextScope.Global })
  private onSelectProject = () => this.setState({ scope: ContextScope.Project })

  private onToggle = (repositoryId: number) => {
    const expanded = new Set(this.state.expanded)
    if (expanded.has(repositoryId)) {
      expanded.delete(repositoryId)
    } else {
      expanded.add(repositoryId)
    }
    this.setState({ expanded })
  }

  private renderHeader() {
    const { progress, section } = this.props
    const total = this.visibleRepositories().reduce(
      (sum, r) => sum + reclaimableBytes(this.inventoryFor(r)),
      0
    )

    return (
      <header className="workspace-header">
        <div className="workspace-title">
          <h1>{sectionTitle(section)}</h1>
          <p>{sectionSubtitle(section)}</p>
        </div>

        <div className="workspace-summary">
          {section === AppSection.Disk && total > 0 && (
            <div className="workspace-reclaimable">
              <strong>{formatBytes(total)}</strong>
              <span>reclaimable</span>
            </div>
          )}

          <input
            type="search"
            className="workspace-filter"
            placeholder="Filter projects"
            value={this.state.filter}
            onChange={this.onFilterChanged}
            aria-label="Filter projects"
          />

          {progress.scanning ? (
            <span className="workspace-progress">
              Scanning {progress.completed} of {progress.total}…
            </span>
          ) : (
            <Button onClick={this.props.onRescan}>
              <Octicon symbol={octicons.sync} /> Rescan
            </Button>
          )}
        </div>
      </header>
    )
  }

  /**
   * Global context and project context are different in kind, not in degree: one
   * reaches every repository on the machine and the other reaches one. Mixing
   * them into a single list would hide exactly the distinction that matters.
   */
  private renderScopeTabs() {
    const { scope } = this.state
    const globalCount = this.props.globalContext.contextFiles.length

    return (
      <div className="workspace-scopes" role="tablist">
        <button
          role="tab"
          aria-selected={scope === ContextScope.Project}
          className={classNames('workspace-scope', {
            selected: scope === ContextScope.Project,
          })}
          onClick={this.onSelectProject}
        >
          {scopeDisplayName(ContextScope.Project)}
          <span className="workspace-scope-count">
            {this.props.repositories.length}
          </span>
        </button>

        <button
          role="tab"
          aria-selected={scope === ContextScope.Global}
          className={classNames('workspace-scope', {
            selected: scope === ContextScope.Global,
          })}
          onClick={this.onSelectGlobal}
        >
          {scopeDisplayName(ContextScope.Global)}
          <span className="workspace-scope-count">{globalCount}</span>
        </button>
      </div>
    )
  }

  private renderGlobal() {
    return (
      <GlobalContextPanel
        context={this.props.globalContext}
        onOpenFile={this.props.onOpenPath}
      />
    )
  }

  private renderRepositories() {
    const repositories = this.visibleRepositories()

    if (repositories.length === 0) {
      return (
        <div className="workspace-empty">
          <p>No projects match “{this.state.filter}”.</p>
        </div>
      )
    }

    return repositories.map(repository => (
      <RepositoryRow
        key={repository.id}
        section={this.props.section}
        repository={repository}
        inventory={this.inventoryFor(repository)}
        expanded={this.state.expanded.has(repository.id)}
        onToggle={this.onToggle}
        onOpenFile={this.props.onOpenFile}
        onCleanUp={this.props.onCleanUp}
      />
    ))
  }

  private visibleRepositories(): ReadonlyArray<Repository> {
    const filter = this.state.filter.trim().toLowerCase()

    const matching =
      filter === ''
        ? this.props.repositories
        : this.props.repositories.filter(r =>
            (r.alias ?? r.name).toLowerCase().includes(filter)
          )

    if (this.props.section !== AppSection.Disk) {
      return matching
    }

    // On the disk lens, the biggest offenders first. Sorting alphabetically
    // would bury the four-gigabyte node_modules under a project called `api`.
    return [...matching].sort(
      (a, b) =>
        reclaimableBytes(this.inventoryFor(b)) -
        reclaimableBytes(this.inventoryFor(a))
    )
  }

  private inventoryFor(repository: Repository): IRepositoryInventory {
    return (
      this.props.inventories.get(repository.id) ?? {
        repositoryId: repository.id,
        repositoryPath: repository.path,
        scannedAt: 0,
        status: { kind: 'ok' },
        contextFiles: [],
        docs: [],
        artifacts: [],
      }
    )
  }
}
