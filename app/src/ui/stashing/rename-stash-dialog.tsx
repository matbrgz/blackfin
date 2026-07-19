import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Row } from '../lib/row'
import { IStashEntry } from '../../models/stash-entry'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'

interface IRenameStashProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly stash: IStashEntry
  readonly onDismissed: () => void
}

interface IRenameStashState {
  readonly name: string
  readonly isRenaming: boolean
}

/**
 * Dialog for setting or clearing the custom name of a stash entry
 */
export class RenameStashDialog extends React.Component<
  IRenameStashProps,
  IRenameStashState
> {
  public constructor(props: IRenameStashProps) {
    super(props)

    this.state = {
      name: props.stash.customName ?? '',
      isRenaming: false,
    }
  }

  public render() {
    const title = __DARWIN__ ? 'Rename Stash' : 'Rename stash'

    return (
      <Dialog
        id="rename-stash"
        title={title}
        loading={this.state.isRenaming}
        disabled={this.state.isRenaming}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row>
            <TextBox
              label="Name"
              value={this.state.name}
              autoFocus={true}
              placeholder="Leave empty to remove the name"
              onValueChanged={this.onNameChanged}
            />
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup okButtonText={title} />
        </DialogFooter>
      </Dialog>
    )
  }

  private onNameChanged = (name: string) => {
    this.setState({ name })
  }

  private onSubmit = async () => {
    const { dispatcher, repository, stash, onDismissed } = this.props

    this.setState({ isRenaming: true })

    try {
      await dispatcher.renameStash(repository, stash, this.state.name)
    } finally {
      this.setState({ isRenaming: false })
    }

    onDismissed()
  }
}
