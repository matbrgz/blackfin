import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Commit } from '../../models/commit'

interface IWarnResetToPushedCommitProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly commit: Commit
  readonly onDismissed: () => void
}

interface IWarnResetToPushedCommitState {
  readonly isLoading: boolean
}

/**
 * Dialog that warns the user that resetting to the selected commit will discard
 * commits that have already been pushed to the remote repository.
 */
export class WarnResetToPushedCommit extends React.Component<
  IWarnResetToPushedCommitProps,
  IWarnResetToPushedCommitState
> {
  public constructor(props: IWarnResetToPushedCommitProps) {
    super(props)
    this.state = {
      isLoading: false,
    }
  }

  public render() {
    const title = __DARWIN__
      ? 'Reset to Pushed Commit?'
      : 'Reset to pushed commit?'

    return (
      <Dialog
        id="warn-reset-to-pushed-commit"
        type="warning"
        title={title}
        loading={this.state.isLoading}
        disabled={this.state.isLoading}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        role="alertdialog"
        ariaDescribedBy="reset-to-pushed-commit-warning-message"
      >
        <DialogContent>
          <p id="reset-to-pushed-commit-warning-message">
            Resetting to this commit may discard commits that have already been
            pushed to the remote repository. If others have pulled those
            commits, they may encounter issues when pushing or pulling.
          </p>
          <p>
            This will rewrite your local history. Are you sure you want to
            continue?
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Reset" />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, commit, onDismissed } = this.props
    this.setState({ isLoading: true })

    try {
      await dispatcher.resetToCommit(repository, commit, false)
    } finally {
      this.setState({ isLoading: false })
    }

    onDismissed()
  }
}
