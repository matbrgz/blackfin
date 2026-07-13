import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { Repository } from '../../models/repository'
import { IArtifactDirectory } from '../../models/workspace-inventory'
import { CleanupOutcome } from '../../lib/workspace/cleanup'
import { artifactDisplayName } from '../../lib/workspace/catalog'
import { plural } from './display'

interface IConfirmCleanupDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly artifacts: ReadonlyArray<IArtifactDirectory>
  readonly onDismissed: () => void
}

interface IConfirmCleanupDialogState {
  readonly isDeleting: boolean

  /**
   * Null until the cleanup has run. Once it has, the dialog stops being a
   * confirmation and becomes a report — because a refusal that scrolls past in a
   * toast is a refusal nobody reads.
   */
  readonly outcomes: ReadonlyArray<CleanupOutcome> | null
}

/**
 * Asks before moving reclaimable directories to the trash, and then says what
 * actually happened to each one.
 *
 * Both halves matter. Deleting a project's `node_modules` without asking is a
 * ten-minute rebuild the user did not agree to, and on a plane it is not a
 * rebuild at all. And every path is revalidated against the disk at the moment
 * of deletion, so some of them come back refused — that directory is now a
 * symlink, that path escaped the repository root — and a refusal is often the
 * most useful thing this screen produced all day. It does not get swallowed.
 */
export class ConfirmCleanupDialog extends React.Component<
  IConfirmCleanupDialogProps,
  IConfirmCleanupDialogState
> {
  public constructor(props: IConfirmCleanupDialogProps) {
    super(props)
    this.state = { isDeleting: false, outcomes: null }
  }

  private onConfirm = async () => {
    this.setState({ isDeleting: true })

    const outcomes = await this.props.dispatcher.cleanUpWorkspace(
      this.props.repository,
      this.props.artifacts.map(a => a.relativePath)
    )

    this.setState({ isDeleting: false, outcomes })
  }

  private renderTargets() {
    const { artifacts, repository } = this.props
    const total = artifacts.reduce((sum, a) => sum + a.byteLength, 0)

    return (
      <DialogContent>
        <div id="confirm-cleanup-message">
          <p>
            Move {artifacts.length}{' '}
            {plural(artifacts.length, 'directory', 'directories')} to the trash,
            reclaiming <strong>{formatBytes(total)}</strong>?
          </p>
          <p className="confirm-cleanup-root">{repository.path}</p>
        </div>

        <ul className="confirm-cleanup-targets">
          {artifacts.map(artifact => (
            <li key={artifact.relativePath}>
              <span className="confirm-cleanup-path">
                {artifact.relativePath}
              </span>
              <span className="confirm-cleanup-meta">
                <span className="workspace-role">
                  {artifactDisplayName(artifact.kind)}
                </span>
                <strong>{formatBytes(artifact.byteLength)}</strong>
              </span>
            </li>
          ))}
        </ul>

        <p className="confirm-cleanup-note">
          These go to your system trash, not permanently. Anything that has
          become a symlink, or that no longer looks like what we scanned, is
          skipped and reported.
        </p>
      </DialogContent>
    )
  }

  private renderOutcomes(outcomes: ReadonlyArray<CleanupOutcome>) {
    const deleted = outcomes.filter(o => o.kind === 'deleted')
    const problems = outcomes.filter(o => o.kind !== 'deleted')

    // The byte figure is the size at last scan, summed over what was deleted —
    // not a fresh measurement taken at deletion. A directory can grow or shrink
    // between the scan and the click, so this is honestly "about", not a
    // verified reclaimed total. The workspace view corrects itself on the
    // rescan that follows.
    const reclaimed = this.props.artifacts
      .filter(a => deleted.some(d => d.relativePath === a.relativePath))
      .reduce((sum, a) => sum + a.byteLength, 0)

    return (
      <DialogContent>
        <div id="confirm-cleanup-message">
          <p>
            Moved {deleted.length}{' '}
            {plural(deleted.length, 'directory', 'directories')} to the trash,
            freeing about <strong>{formatBytes(reclaimed)}</strong>.
            {problems.length > 0 && (
              <>
                {' '}
                {problems.length} {plural(problems.length, 'was', 'were')} not
                removed.
              </>
            )}
          </p>
        </div>

        {problems.length > 0 && (
          <ul className="confirm-cleanup-problems">
            {problems.map(outcome => (
              <li
                key={outcome.relativePath}
                className={
                  outcome.kind === 'refused'
                    ? 'cleanup-refused'
                    : 'cleanup-failed'
                }
              >
                <Octicon
                  symbol={
                    outcome.kind === 'refused'
                      ? octicons.shield
                      : octicons.alert
                  }
                />
                <span className="confirm-cleanup-path">
                  {outcome.relativePath}
                </span>
                <span className="confirm-cleanup-reason">
                  {outcome.kind === 'refused'
                    ? outcome.reason
                    : outcome.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    )
  }

  public render() {
    const { outcomes, isDeleting } = this.state
    const done = outcomes !== null

    return (
      <Dialog
        id="confirm-workspace-cleanup"
        title={__DARWIN__ ? 'Reclaim Disk Space' : 'Reclaim disk space'}
        type={done ? 'normal' : 'warning'}
        onSubmit={done ? this.props.onDismissed : this.onConfirm}
        onDismissed={this.props.onDismissed}
        disabled={isDeleting}
        loading={isDeleting}
        role="alertdialog"
        ariaDescribedBy="confirm-cleanup-message"
      >
        {done ? this.renderOutcomes(outcomes) : this.renderTargets()}

        <DialogFooter>
          {done ? (
            <Button type="submit">Close</Button>
          ) : (
            <OkCancelButtonGroup
              destructive={true}
              okButtonText="Move to trash"
            />
          )}
        </DialogFooter>
      </Dialog>
    )
  }
}
