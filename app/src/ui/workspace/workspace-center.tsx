import * as React from 'react'
import classNames from 'classnames'
import { UiView } from '../ui-view'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import {
  AgentId,
  ContextRole,
  IArtifactDirectory,
  IContextFile,
  IRepositoryInventory,
  brokenReferences,
  configuredAgents,
  reclaimableBytes,
} from '../../models/workspace-inventory'
import {
  agentDisplayName,
  artifactDisplayName,
} from '../../lib/workspace/catalog'
import { IScanProgress } from '../../lib/stores/workspace-store'

/**
 * Which slice of the inventory the user is looking at. Chosen by the rail, not
 * by tabs inside this view — Agents, Docs and Disk are top-level destinations
 * of the app, and burying them as tabs inside a screen would demote them.
 */
export enum Lens {
  Agents = 'agents',
  Docs = 'docs',
  Disk = 'disk',
}

interface IRepositoryHeaderProps {
  readonly repositoryId: number
  readonly name: string
  readonly expanded: boolean
  readonly onToggle: (repositoryId: number) => void
  readonly children?: React.ReactNode
}

class RepositoryHeader extends React.Component<IRepositoryHeaderProps> {
  private onClick = () => this.props.onToggle(this.props.repositoryId)

  public render() {
    const { name, expanded, children } = this.props

    return (
      <button
        className="workspace-repository-header"
        onClick={this.onClick}
        aria-expanded={expanded}
      >
        <Octicon
          symbol={expanded ? octicons.chevronDown : octicons.chevronRight}
        />
        <span className="workspace-repository-name">{name}</span>
        {children}
      </button>
    )
  }
}

interface IFileButtonProps {
  readonly repository: Repository
  readonly relativePath: string
  readonly onOpen: (repository: Repository, relativePath: string) => void
}

class FileButton extends React.Component<IFileButtonProps> {
  private onClick = () =>
    this.props.onOpen(this.props.repository, this.props.relativePath)

  public render() {
    return (
      <button className="workspace-file-path" onClick={this.onClick}>
        {this.props.relativePath}
      </button>
    )
  }
}

interface ICleanUpButtonProps {
  readonly repository: Repository
  readonly relativePaths: ReadonlyArray<string>
  readonly bytes: number
  readonly onCleanUp: (
    repository: Repository,
    relativePaths: ReadonlyArray<string>
  ) => void
}

class CleanUpButton extends React.Component<ICleanUpButtonProps> {
  private onClick = () =>
    this.props.onCleanUp(this.props.repository, this.props.relativePaths)

  public render() {
    return (
      <Button onClick={this.onClick}>
        <Octicon symbol={octicons.trash} /> Reclaim{' '}
        {formatBytes(this.props.bytes)}
      </Button>
    )
  }
}

interface IWorkspaceCenterProps {
  readonly lens: Lens
  readonly repositories: ReadonlyArray<Repository>
  readonly inventories: ReadonlyMap<number, IRepositoryInventory>
  readonly progress: IScanProgress
  readonly onRescan: () => void
  readonly onCleanUp: (
    repository: Repository,
    relativePaths: ReadonlyArray<string>
  ) => void
  readonly onOpenFile: (repository: Repository, relativePath: string) => void
}

interface IWorkspaceCenterState {
  readonly filter: string
  readonly expanded: ReadonlySet<number>
}

/**
 * The cross-project view: every repository the user has, and what each one
 * carries — the context steering its agents, its documentation, and the build
 * detritus eating its disk.
 */
export class WorkspaceCenter extends React.Component<
  IWorkspaceCenterProps,
  IWorkspaceCenterState
> {
  public constructor(props: IWorkspaceCenterProps) {
    super(props)
    this.state = { filter: '', expanded: new Set() }
  }

  public render() {
    return (
      <UiView id="workspace-center">
        {this.renderHeader()}
        <div className="workspace-list">{this.renderRepositories()}</div>
      </UiView>
    )
  }

  private onFilterChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ filter: event.currentTarget.value })
  }

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
    const { progress, lens } = this.props
    const total = this.visibleRepositories().reduce(
      (sum, r) => sum + reclaimableBytes(this.inventoryFor(r)),
      0
    )

    return (
      <header className="workspace-header">
        <div className="workspace-title">
          <h1>{titleFor(lens)}</h1>
          <p>{subtitleFor(lens)}</p>
        </div>

        <div className="workspace-summary">
          {lens === Lens.Disk && total > 0 && (
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

  private renderRepositories() {
    const repositories = this.visibleRepositories()

    if (repositories.length === 0) {
      return (
        <div className="workspace-empty">
          <p>No projects match “{this.state.filter}”.</p>
        </div>
      )
    }

    return repositories.map(repository =>
      this.renderRepository(repository, this.inventoryFor(repository))
    )
  }

  private renderRepository(
    repository: Repository,
    inventory: IRepositoryInventory
  ) {
    const expanded = this.state.expanded.has(repository.id)

    return (
      <section
        key={repository.id}
        className={classNames('workspace-repository', { expanded })}
      >
        <RepositoryHeader
          repositoryId={repository.id}
          name={repository.alias ?? repository.name}
          expanded={expanded}
          onToggle={this.onToggle}
        >
          {this.renderRepositorySummary(inventory)}
        </RepositoryHeader>

        {expanded && this.renderDetail(repository, inventory)}
      </section>
    )
  }

  private renderRepositorySummary(inventory: IRepositoryInventory) {
    if (inventory.status.kind === 'missing') {
      return <span className="workspace-badge missing">Missing</span>
    }

    if (inventory.status.kind === 'error') {
      return <span className="workspace-badge error">Scan failed</span>
    }

    switch (this.props.lens) {
      case Lens.Agents:
        return this.renderAgentSummary(inventory)
      case Lens.Docs:
        return (
          <span className="workspace-badge">
            {inventory.docs.length} {plural(inventory.docs.length, 'doc')}
          </span>
        )
      case Lens.Disk: {
        const bytes = reclaimableBytes(inventory)
        return bytes === 0 ? (
          <span className="workspace-badge muted">Clean</span>
        ) : (
          <span className="workspace-badge disk">{formatBytes(bytes)}</span>
        )
      }
    }
  }

  private renderAgentSummary(inventory: IRepositoryInventory) {
    const agents = configuredAgents(inventory)

    // A project with no agent context at all is the finding this whole feature
    // exists to surface. Burying it among the others would defeat the point.
    if (agents.length === 0) {
      return <span className="workspace-badge warning">No agent context</span>
    }

    const broken = brokenReferences(inventory).length

    return (
      <>
        {agents.map(agent => (
          <span key={agent} className="workspace-badge agent">
            {agentDisplayName(agent)}
          </span>
        ))}
        {broken > 0 && (
          <span className="workspace-badge error">
            {broken} broken {plural(broken, 'reference')}
          </span>
        )}
      </>
    )
  }

  private renderDetail(
    repository: Repository,
    inventory: IRepositoryInventory
  ) {
    if (inventory.status.kind !== 'ok') {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">
            {inventory.status.kind === 'missing'
              ? 'This project is no longer on disk.'
              : inventory.status.message}
          </p>
        </div>
      )
    }

    switch (this.props.lens) {
      case Lens.Agents:
        return this.renderAgentDetail(repository, inventory)
      case Lens.Docs:
        return this.renderDocDetail(repository, inventory)
      case Lens.Disk:
        return this.renderDiskDetail(repository, inventory)
    }
  }

  private renderAgentDetail(
    repository: Repository,
    inventory: IRepositoryInventory
  ) {
    if (inventory.contextFiles.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">
            No agent reads anything in this project. Nothing steers what gets
            written here.
          </p>
        </div>
      )
    }

    const byAgent = new Map<AgentId, Array<IContextFile>>()
    for (const file of inventory.contextFiles) {
      const files = byAgent.get(file.agent) ?? []
      files.push(file)
      byAgent.set(file.agent, files)
    }

    return (
      <div className="workspace-detail">
        {[...byAgent].map(([agent, files]) => (
          <div key={agent} className="workspace-agent-group">
            <h3>{agentDisplayName(agent)}</h3>
            <ul className="workspace-files">
              {files.map(file => this.renderContextFile(repository, file))}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  private renderContextFile(repository: Repository, file: IContextFile) {
    const broken = file.references.filter(r => !r.exists)

    return (
      <li key={file.relativePath} className="workspace-file">
        <FileButton
          repository={repository}
          relativePath={file.relativePath}
          onOpen={this.props.onOpenFile}
        />

        <span className="workspace-file-meta">
          <span className="workspace-role">{roleDisplayName(file.role)}</span>
          {file.name !== null && (
            <span className="workspace-file-name">{file.name}</span>
          )}
          {file.ruleCount > 0 && (
            <span>
              {file.ruleCount} {plural(file.ruleCount, 'rule')}
            </span>
          )}
          <span>{formatBytes(file.byteLength)}</span>
        </span>

        {file.description !== null && (
          <p className="workspace-file-description">{file.description}</p>
        )}

        {file.skippedReason !== null && (
          <p className="workspace-file-skipped">{file.skippedReason}</p>
        )}

        {broken.length > 0 && (
          <ul className="workspace-broken">
            {broken.map(reference => (
              <li key={reference.target}>
                <Octicon symbol={octicons.alert} />
                Points at <code>{reference.target}</code>, which does not exist
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  private renderDocDetail(
    repository: Repository,
    inventory: IRepositoryInventory
  ) {
    if (inventory.docs.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">No documentation.</p>
        </div>
      )
    }

    return (
      <div className="workspace-detail">
        <ul className="workspace-files">
          {inventory.docs.map(doc => (
            <li key={doc.relativePath} className="workspace-file">
              <FileButton
                repository={repository}
                relativePath={doc.relativePath}
                onOpen={this.props.onOpenFile}
              />
              <span className="workspace-file-meta">
                {doc.title !== null && (
                  <span className="workspace-file-name">{doc.title}</span>
                )}
                <span>
                  {doc.lineCount} {plural(doc.lineCount, 'line')}
                </span>
                <span>{formatBytes(doc.byteLength)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  private renderDiskDetail(
    repository: Repository,
    inventory: IRepositoryInventory
  ) {
    if (inventory.artifacts.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">Nothing to reclaim.</p>
        </div>
      )
    }

    const sorted = [...inventory.artifacts].sort(
      (a, b) => b.byteLength - a.byteLength
    )

    return (
      <div className="workspace-detail">
        <ul className="workspace-files">
          {sorted.map(artifact => this.renderArtifact(artifact))}
        </ul>

        <div className="workspace-cleanup">
          <CleanUpButton
            repository={repository}
            relativePaths={sorted.map(a => a.relativePath)}
            bytes={reclaimableBytes(inventory)}
            onCleanUp={this.props.onCleanUp}
          />
          <span className="workspace-cleanup-note">
            Moves these directories to the trash.
          </span>
        </div>
      </div>
    )
  }

  private renderArtifact(artifact: IArtifactDirectory) {
    return (
      <li key={artifact.relativePath} className="workspace-file">
        <span className="workspace-file-path">{artifact.relativePath}</span>
        <span className="workspace-file-meta">
          <span className="workspace-role">
            {artifactDisplayName(artifact.kind)}
          </span>
          <span>
            {artifact.fileCount} {plural(artifact.fileCount, 'file')}
          </span>
          <strong>{formatBytes(artifact.byteLength)}</strong>
        </span>
      </li>
    )
  }

  private visibleRepositories(): ReadonlyArray<Repository> {
    const filter = this.state.filter.trim().toLowerCase()

    const matching =
      filter === ''
        ? this.props.repositories
        : this.props.repositories.filter(r =>
            (r.alias ?? r.name).toLowerCase().includes(filter)
          )

    if (this.props.lens !== Lens.Disk) {
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

function titleFor(lens: Lens): string {
  switch (lens) {
    case Lens.Agents:
      return 'Agents'
    case Lens.Docs:
      return 'Docs'
    case Lens.Disk:
      return 'Disk'
  }
}

function subtitleFor(lens: Lens): string {
  switch (lens) {
    case Lens.Agents:
      return 'What steers the agents writing your code, across every project.'
    case Lens.Docs:
      return 'Documentation across every project.'
    case Lens.Disk:
      return 'What your projects are sitting on, and what you can take back.'
  }
}

function roleDisplayName(role: ContextRole): string {
  switch (role) {
    case ContextRole.Instructions:
      return 'Instructions'
    case ContextRole.Skill:
      return 'Skill'
    case ContextRole.Command:
      return 'Command'
    case ContextRole.Subagent:
      return 'Subagent'
    case ContextRole.Prompt:
      return 'Prompt'
    case ContextRole.Settings:
      return 'Settings'
    case ContextRole.Hook:
      return 'Hook'
  }
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
