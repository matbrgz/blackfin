import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import { AppSection } from '../../models/app-section'
import {
  IArtifactDirectory,
  IRepositoryInventory,
  brokenReferences,
  configuredAgents,
  reclaimableBytes,
} from '../../models/workspace-inventory'
import { agentDisplayName } from '../../lib/workspace/catalog'
import { ContextFileList } from './context-file-list'
import { DocFileList } from './doc-file-list'
import { ArtifactList } from './artifact-list'
import { explainStatus, plural } from './display'
import { Badge } from '../lib/badge'

interface IRepositoryRowProps {
  readonly section: AppSection
  readonly repository: Repository
  readonly inventory: IRepositoryInventory
  readonly expanded: boolean
  readonly onToggle: (repositoryId: number) => void
  readonly onOpenFile: (repository: Repository, relativePath: string) => void
  readonly onCleanUp: (
    repository: Repository,
    artifacts: ReadonlyArray<IArtifactDirectory>
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
      return <Badge kind="health" health="broken" label="Missing" />
    }

    if (inventory.status.kind === 'error') {
      return <Badge kind="health" health="broken" label="Scan failed" />
    }

    // Not the same as an empty project, and it does not get to look like one —
    // nor like a clean one, which is why this is `unknown` and not quietly `ok`.
    if (inventory.status.kind === 'never-scanned') {
      return <Badge kind="health" health="unknown" label="Not scanned yet" />
    }

    switch (section) {
      case AppSection.Agents:
        return this.renderAgentSummary()
      case AppSection.Docs:
        return (
          <Badge
            kind="count"
            label={`${inventory.docs.length} ${plural(
              inventory.docs.length,
              'doc'
            )}`}
          />
        )
      case AppSection.Disk: {
        const bytes = reclaimableBytes(inventory)
        return bytes === 0 ? (
          <Badge kind="health" health="ok" label="Clean" />
        ) : (
          <Badge kind="count" label={formatBytes(bytes)} />
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
      return <Badge kind="health" health="attention" label="No agent context" />
    }

    const broken = brokenReferences(inventory).length

    return (
      <>
        {agents.map(agent => (
          <Badge key={agent} kind="agent" label={agentDisplayName(agent)} />
        ))}
        {broken > 0 && (
          <Badge
            kind="health"
            health="broken"
            label={`${broken} broken ${plural(broken, 'reference')}`}
          />
        )}
      </>
    )
  }

  private renderDetail() {
    const { inventory, section, repository, onCleanUp } = this.props

    if (inventory.status.kind !== 'ok') {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">{explainStatus(inventory.status)}</p>
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
