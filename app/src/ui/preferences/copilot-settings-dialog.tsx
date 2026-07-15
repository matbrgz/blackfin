import * as React from 'react'
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
  readonly onConfigureCustomProviders: () => void
  readonly onDismissed: () => void
}

export class CopilotSettingsDialog extends React.Component<ICopilotSettingsDialogProps> {
  private dialogElement: HTMLDialogElement | null = null
  private scrollResetFrame: number | null = null

  public componentWillUnmount() {
    this.setDialogElement(null)
  }

  private setDialogElement = (dialogElement: HTMLDialogElement | null) => {
    this.dialogElement?.removeEventListener('dialog-show', this.onDialogShown)

    if (dialogElement === null && this.scrollResetFrame !== null) {
      cancelAnimationFrame(this.scrollResetFrame)
      this.scrollResetFrame = null
    }

    this.dialogElement = dialogElement
    this.dialogElement?.addEventListener('dialog-show', this.onDialogShown)
  }

  private onDialogShown = () => {
    if (this.scrollResetFrame !== null) {
      cancelAnimationFrame(this.scrollResetFrame)
    }

    this.scrollResetFrame = requestAnimationFrame(() => {
      const scrollContainer = this.dialogElement?.querySelector(
        '.copilot-settings-scroll'
      )

      if (scrollContainer instanceof HTMLElement) {
        scrollContainer.scrollTop = 0
      }

      this.scrollResetFrame = null
    })
  }

  public render() {
    return (
      <Dialog
        id="copilot-settings-dialog"
        className="copilot-settings-dialog"
        title={`Copilot Settings: @${this.props.account.login}`}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
        onDialogRef={this.setDialogElement}
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
            onConfigureCustomProviders={this.props.onConfigureCustomProviders}
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
