import * as React from 'react'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import {
  IArtifactDirectory,
  reclaimableBytes,
  IRepositoryInventory,
} from '../../models/workspace-inventory'
import { artifactDisplayName } from '../../lib/workspace/catalog'
import { plural } from './display'

interface ICleanUpButtonProps {
  readonly repository: Repository
  readonly artifacts: ReadonlyArray<IArtifactDirectory>
  readonly bytes: number
  readonly onCleanUp: (
    repository: Repository,
    artifacts: ReadonlyArray<IArtifactDirectory>
  ) => void
}

class CleanUpButton extends React.Component<ICleanUpButtonProps> {
  private onClick = () =>
    this.props.onCleanUp(this.props.repository, this.props.artifacts)

  public render() {
    return (
      <Button onClick={this.onClick}>
        <Octicon symbol={octicons.trash} /> Reclaim{' '}
        {formatBytes(this.props.bytes)}…
      </Button>
    )
  }
}

function renderArtifact(artifact: IArtifactDirectory) {
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

interface IArtifactListProps {
  readonly repository: Repository
  readonly inventory: IRepositoryInventory

  /**
   * Opens the confirmation. Nothing is deleted on this path — the artifacts go
   * to a dialog that shows what will be removed, and only a confirmed dialog
   * calls the cleanup.
   */
  readonly onCleanUp: (
    repository: Repository,
    artifacts: ReadonlyArray<IArtifactDirectory>
  ) => void
}

export class ArtifactList extends React.Component<IArtifactListProps> {
  public render() {
    const { repository, inventory, onCleanUp } = this.props

    if (inventory.artifacts.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">Nothing to reclaim.</p>
        </div>
      )
    }

    // Biggest offenders first. Sorting by name would bury the four-gigabyte
    // node_modules under a directory called `.cache`.
    const sorted = [...inventory.artifacts].sort(
      (a, b) => b.byteLength - a.byteLength
    )

    return (
      <div className="workspace-detail">
        <ul className="workspace-files">{sorted.map(renderArtifact)}</ul>

        <div className="workspace-cleanup">
          <CleanUpButton
            repository={repository}
            artifacts={sorted}
            bytes={reclaimableBytes(inventory)}
            onCleanUp={onCleanUp}
          />
          <span className="workspace-cleanup-note">
            Asks first, then moves these directories to the trash.
          </span>
        </div>
      </div>
    )
  }
}
