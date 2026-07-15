import * as React from 'react'
import { IStashEntry } from '../../models/stash-entry'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { PopupType } from '../../models/popup'
import { ErrorWithMetadata } from '../../lib/error-with-metadata'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RetryActionType } from '../../models/retry-actions'

interface IStashDiffHeaderProps {
  readonly stashEntry: IStashEntry
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly askForConfirmationOnDiscardStash: boolean
}

interface IStashDiffHeaderState {
  readonly isRestoring: boolean
  readonly isDiscarding: boolean
}

/**
 * Component to provide the actions that can be performed
 * on a stash while viewing a stash diff
 */
export class StashDiffHeader extends React.Component<
  IStashDiffHeaderProps,
  IStashDiffHeaderState
> {
  public constructor(props: IStashDiffHeaderProps) {
    super(props)

    this.state = {
      isRestoring: false,
      isDiscarding: false,
    }
  }

  public render() {
    const { isRestoring, isDiscarding } = this.state
    const { stashEntry } = this.props

    return (
      <div className="header">
        <div className="title-row">
          <h3>{stashEntry.customName ?? 'Stashed changes'}</h3>
          <Button
            className="rename-stash-button"
            onClick={this.onRenameClick}
            tooltip="Rename stash"
            ariaLabel="Rename stash"
            disabled={isRestoring || isDiscarding}
          >
            <Octicon symbol={octicons.pencil} />
          </Button>
        </div>
        <div className="row button-group">
          <Button
            onClick={this.onCloseClick}
            tooltip={'Close the stash view'}
            className="button-with-icon"
          >
            <Octicon symbol={octicons.x} className="mr" />
            Close
          </Button>
          <Button
            onClick={this.onRestoreClick}
            type="submit"
            tooltip={'Restore the stashed changes into the working directory'}
            className="button-with-icon"
            disabled={isRestoring || isDiscarding}
          >
            <Octicon symbol={octicons.fileDiff} className="mr" />
            Restore Changes
          </Button>
          <Button
            onClick={this.onDiscardClick}
            tooltip={'Discard the stashed changes'}
            className="destructive button-with-icon"
            disabled={isRestoring || isDiscarding}
          >
            <Octicon symbol={octicons.trash} className="mr" />
            Discard
          </Button>
        </div>
      </div>
    )
  }

  private onRenameClick = () => {
    const { dispatcher, repository, stashEntry } = this.props

    dispatcher.showPopup({
      type: PopupType.RenameStash,
      stash: stashEntry,
      repository,
    })
  }

  private onDiscardClick = async () => {
    const {
      dispatcher,
      repository,
      stashEntry,
      askForConfirmationOnDiscardStash,
    } = this.props

    if (!askForConfirmationOnDiscardStash) {
      this.setState({
        isDiscarding: true,
      })

      try {
        await dispatcher.dropStash(repository, stashEntry)
      } finally {
        this.setState({
          isDiscarding: false,
        })
      }
    } else {
      dispatcher.showPopup({
        type: PopupType.ConfirmDiscardStash,
        stash: stashEntry,
        repository,
      })
    }
  }

  private onRestoreClick = async () => {
    const { dispatcher, repository, stashEntry } = this.props

    try {
      this.setState({ isRestoring: true })
      await dispatcher.popStash(repository, stashEntry)
    } catch (err) {
      const errorWithMetadata = new ErrorWithMetadata(err, {
        repository: repository,
        retryAction: {
          type: RetryActionType.PopStash,
          stashEntry,
          repository,
        },
      })
      dispatcher.postError(errorWithMetadata)
    } finally {
      this.setState({ isRestoring: false })
    }
  }

  private onCloseClick = () => {
    const { dispatcher, repository } = this.props
    dispatcher.selectWorkingDirectoryFiles(repository)
  }
}
