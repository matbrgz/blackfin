import * as React from 'react'
import * as ReactDOM from 'react-dom'
import type { Model } from '@github/copilot-sdk/dist/generated/rpc'
import type { IBYOKProvider } from '../../lib/copilot/byok'
import type {
  CopilotFeature,
  CopilotModelSelections,
  CopilotQuotaSnapshots,
} from '../../lib/stores/copilot-store'
import type { Account } from '../../models/account'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { CopilotUserSettings } from './copilot-user-settings'

interface ICopilotSettingsDialogProps {
  readonly account: Account
  readonly selectedCopilotModels: CopilotModelSelections
  readonly copilotModels: ReadonlyArray<Model> | null
  readonly copilotQuotaSnapshots: CopilotQuotaSnapshots | null
  readonly byokProviders: ReadonlyArray<IBYOKProvider>
  readonly showBYOKSettings: boolean
  readonly alwaysUseCopilotForConflictResolution: boolean
  readonly onSelectedCopilotModelChanged: (
    feature: CopilotFeature,
    model: string | null
  ) => void
  readonly onAlwaysUseCopilotForConflictResolutionChanged: (
    checked: boolean
  ) => void
  readonly onAddBYOKProvider: () => void
  readonly onEditBYOKProvider: (provider: IBYOKProvider) => void
  readonly onDeleteBYOKProvider: (provider: IBYOKProvider) => void
  readonly onDismissed: () => void
}

export class CopilotSettingsDialog extends React.Component<ICopilotSettingsDialogProps> {
  public render() {
    const dialog = this.renderDialog()

    if (document.body === null) {
      return dialog
    }

    return ReactDOM.createPortal(dialog, document.body)
  }

  private renderDialog() {
    return (
      <Dialog
        id="copilot-settings-dialog"
        className="copilot-settings-dialog"
        title={`Copilot Settings: @${this.props.account.login}`}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent className="copilot-tab">
          <CopilotUserSettings
            account={this.props.account}
            selectedCopilotModels={this.props.selectedCopilotModels}
            copilotModels={this.props.copilotModels}
            copilotQuotaSnapshots={this.props.copilotQuotaSnapshots}
            byokProviders={this.props.byokProviders}
            showBYOKSettings={this.props.showBYOKSettings}
            alwaysUseCopilotForConflictResolution={
              this.props.alwaysUseCopilotForConflictResolution
            }
            onSelectedCopilotModelChanged={
              this.props.onSelectedCopilotModelChanged
            }
            onAlwaysUseCopilotForConflictResolutionChanged={
              this.props.onAlwaysUseCopilotForConflictResolutionChanged
            }
            onAddBYOKProvider={this.props.onAddBYOKProvider}
            onEditBYOKProvider={this.props.onEditBYOKProvider}
            onDeleteBYOKProvider={this.props.onDeleteBYOKProvider}
          />
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Done"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
