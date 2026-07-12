import * as React from 'react'
import classNames from 'classnames'
import { UiView } from '../ui-view'
import { Button } from '../lib/button'
import { Octicon, OcticonSymbol } from '../octicons'
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
import { IScanProgress } from '../../lib/stores/workspace-store'

interface IHomeStatProps {
  readonly value: string
  readonly label: string
  readonly section: AppSection
  readonly alarming: boolean
  readonly onNavigate: (section: AppSection) => void
}

class HomeStat extends React.Component<IHomeStatProps> {
  private onClick = () => this.props.onNavigate(this.props.section)

  public render() {
    const { value, label, alarming } = this.props

    return (
      <button
        className={classNames('home-stat', { alarming })}
        onClick={this.onClick}
      >
        <strong>{value}</strong>
        <span>{label}</span>
      </button>
    )
  }
}

interface IAttentionRowProps {
  readonly icon: OcticonSymbol
  readonly name: string
  readonly message: string
  readonly section: AppSection
  readonly onNavigate: (section: AppSection) => void
}

class AttentionRow extends React.Component<IAttentionRowProps> {
  private onClick = () => this.props.onNavigate(this.props.section)

  public render() {
    return (
      <li>
        <button onClick={this.onClick}>
          <Octicon symbol={this.props.icon} />
          <strong>{this.props.name}</strong>
          <span>{this.props.message}</span>
        </button>
      </li>
    )
  }
}

interface IProjectCardProps {
  readonly repository: Repository
  readonly inventory: IRepositoryInventory | undefined
  readonly onOpen: (repository: Repository) => void
}

class ProjectCard extends React.Component<IProjectCardProps> {
  private onClick = () => this.props.onOpen(this.props.repository)

  public render() {
    const { repository, inventory } = this.props
    const agents = inventory === undefined ? [] : configuredAgents(inventory)
    const reclaimable =
      inventory === undefined ? 0 : reclaimableBytes(inventory)

    return (
      <button className="home-project" onClick={this.onClick}>
        <span className="home-project-name">
          {repository.alias ?? repository.name}
        </span>

        <span className="home-project-agents">
          {agents.length === 0 ? (
            <span className="home-project-none">No agent context</span>
          ) : (
            agents.map(agent => (
              <span key={agent} className="home-project-agent">
                {agentDisplayName(agent)}
              </span>
            ))
          )}
        </span>

        {reclaimable > 0 && (
          <span className="home-project-disk">
            {formatBytes(reclaimable)} reclaimable
          </span>
        )}
      </button>
    )
  }
}

interface IHomeViewProps {
  readonly repositories: ReadonlyArray<Repository>
  readonly inventories: ReadonlyMap<number, IRepositoryInventory>
  readonly progress: IScanProgress
  readonly onRescan: () => void
  readonly onOpenRepository: (repository: Repository) => void
  readonly onNavigate: (section: AppSection) => void
}

/**
 * The command center. What Blackfin opens on, and the reason it is not a git
 * client: the first thing it shows you is the state of your work across every
 * project, not the diff of whichever repository you happened to close last.
 */
export class HomeView extends React.Component<IHomeViewProps> {
  public render() {
    return (
      <UiView id="home-view">
        {this.renderHeader()}
        <div className="home-scroll">
          {this.renderStats()}
          {this.renderAttention()}
          {this.renderProjects()}
        </div>
      </UiView>
    )
  }

  private renderHeader() {
    const { progress } = this.props

    return (
      <header className="home-header">
        <div>
          <h1>Blackfin</h1>
          <p>Agentic control center</p>
        </div>

        {progress.scanning ? (
          <span className="home-progress">
            Scanning {progress.completed} of {progress.total}…
          </span>
        ) : (
          <Button onClick={this.props.onRescan}>
            <Octicon symbol={octicons.sync} /> Rescan
          </Button>
        )}
      </header>
    )
  }

  private renderStats() {
    const { repositories, onNavigate } = this.props
    const inventories = this.knownInventories()

    const withoutContext = inventories.filter(
      i => configuredAgents(i).length === 0
    ).length
    const broken = inventories.reduce(
      (sum, i) => sum + brokenReferences(i).length,
      0
    )
    const reclaimable = inventories.reduce(
      (sum, i) => sum + reclaimableBytes(i),
      0
    )

    return (
      <div className="home-stats">
        <HomeStat
          value={String(repositories.length)}
          label={repositories.length === 1 ? 'project' : 'projects'}
          section={AppSection.Code}
          alarming={false}
          onNavigate={onNavigate}
        />
        <HomeStat
          value={String(withoutContext)}
          label="without agent context"
          section={AppSection.Agents}
          alarming={withoutContext > 0}
          onNavigate={onNavigate}
        />
        <HomeStat
          value={String(broken)}
          label={broken === 1 ? 'broken reference' : 'broken references'}
          section={AppSection.Agents}
          alarming={broken > 0}
          onNavigate={onNavigate}
        />
        <HomeStat
          value={formatBytes(reclaimable)}
          label="reclaimable"
          section={AppSection.Disk}
          alarming={false}
          onNavigate={onNavigate}
        />
      </div>
    )
  }

  private renderAttention() {
    const { onNavigate } = this.props
    const rows: Array<JSX.Element> = []

    for (const repository of this.props.repositories) {
      const inventory = this.props.inventories.get(repository.id)
      if (inventory === undefined || inventory.status.kind !== 'ok') {
        continue
      }

      const name = repository.alias ?? repository.name
      const broken = brokenReferences(inventory)

      if (broken.length > 0) {
        rows.push(
          <AttentionRow
            key={`broken-${repository.id}`}
            icon={octicons.alert}
            name={name}
            message={
              broken.length === 1
                ? 'An agent instruction points at a file that does not exist'
                : `${broken.length} agent instructions point at files that do not exist`
            }
            section={AppSection.Agents}
            onNavigate={onNavigate}
          />
        )
      }

      if (configuredAgents(inventory).length === 0) {
        rows.push(
          <AttentionRow
            key={`empty-${repository.id}`}
            icon={octicons.question}
            name={name}
            message="No agent reads anything here. Nothing steers what gets written."
            section={AppSection.Agents}
            onNavigate={onNavigate}
          />
        )
      }
    }

    if (rows.length === 0) {
      return null
    }

    return (
      <section className="home-attention">
        <h2>Needs attention</h2>
        <ul>{rows}</ul>
      </section>
    )
  }

  private renderProjects() {
    const { repositories, inventories, onOpenRepository } = this.props

    if (repositories.length === 0) {
      return (
        <section className="home-projects">
          <p className="home-empty">No projects yet.</p>
        </section>
      )
    }

    return (
      <section className="home-projects">
        <h2>Projects</h2>
        <div className="home-project-grid">
          {repositories.map(repository => (
            <ProjectCard
              key={repository.id}
              repository={repository}
              inventory={inventories.get(repository.id)}
              onOpen={onOpenRepository}
            />
          ))}
        </div>
      </section>
    )
  }

  private knownInventories(): ReadonlyArray<IRepositoryInventory> {
    return this.props.repositories
      .map(r => this.props.inventories.get(r.id))
      .filter((i): i is IRepositoryInventory => i !== undefined)
  }
}
