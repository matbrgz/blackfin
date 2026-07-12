import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import { AppSection } from '../../models/app-section'
import {
  IRepositoryInventory,
  brokenReferences,
  configuredAgents,
  reclaimableBytes,
} from '../../models/workspace-inventory'
import { agentDisplayName } from '../../lib/workspace/catalog'
import { ContextFileList } from './context-file-list'
import { DocFileList } from './doc-file-list'
import { ArtifactList } from './artifact-list'
import { plural } from './display'

interface IRepositoryRowProps {
  readonly section: AppSection
  readonly repository: Repository
  readonly inventory: IRepositoryInventory
  readonly expanded: boolean
  readonly onToggle: (repositoryId: number) => void
  readonly onOpenFile: (repository: Repository, relativePath: string) => void
  readonly onCleanUp: (
    repository: Repository,
    relativePaths: ReadonlyArray<string>
  ) => void
}

/** One project in the cross-project list: a summary, and its detail when open. */
export class RepositoryRow extends React.Component<IRepositoryRowProps> {
  private onToggle = () => this.props.onToggle(this.props.repository.id)

  private onOpenFile = (relativePath: string) =>
    this.props.onOpenFile(this.props.repository, relativePath)

  public render() {
    const { repository, expanded } = this.props

    return (
      <section className={classNames('workspace-repository', { expanded })}>
        <button
          className="workspace-repository-header"
          onClick={this.onToggle}
          aria-expanded={expanded}
        >
          <Octicon
            symbol={expanded ? octicons.chevronDown : octicons.chevronRight}
          />
          <span className="workspace-repository-name">
            {repository.alias ?? repository.name}
          </span>
          {this.renderSummary()}
        </button>

        {expanded && this.renderDetail()}
      </section>
    )
  }

  private renderSummary() {
    const { inventory, section } = this.props

    if (inventory.status.kind === 'missing') {
      return <span className="workspace-badge missing">Missing</span>
    }

    if (inventory.status.kind === 'error') {
      return <span className="workspace-badge error">Scan failed</span>
    }

    switch (section) {
      case AppSection.Agents:
        return this.renderAgentSummary()
      case AppSection.Docs:
        return (
          <span className="workspace-badge">
            {inventory.docs.length} {plural(inventory.docs.length, 'doc')}
          </span>
        )
      case AppSection.Disk: {
        const bytes = reclaimableBytes(inventory)
        return bytes === 0 ? (
          <span className="workspace-badge muted">Clean</span>
        ) : (
          <span className="workspace-badge disk">{formatBytes(bytes)}</span>
        )
      }
      default:
        return null
    }
  }

  private renderAgentSummary() {
    const { inventory } = this.props
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

  private renderDetail() {
    const { inventory, section, repository, onCleanUp } = this.props

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

    switch (section) {
      case AppSection.Agents:
        if (inventory.contextFiles.length === 0) {
          return (
            <div className="workspace-detail">
              <p className="workspace-empty">
                No agent reads anything in this project. Nothing steers what
                gets written here.
              </p>
            </div>
          )
        }
        return (
          <div className="workspace-detail">
            <ContextFileList
              files={inventory.contextFiles}
              onOpen={this.onOpenFile}
            />
          </div>
        )

      case AppSection.Docs:
        return <DocFileList docs={inventory.docs} onOpen={this.onOpenFile} />

      case AppSection.Disk:
        return (
          <ArtifactList
            repository={repository}
            inventory={inventory}
            onCleanUp={onCleanUp}
          />
        )

      default:
        return null
    }
  }
}
