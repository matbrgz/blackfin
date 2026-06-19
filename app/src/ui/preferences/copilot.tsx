import * as React from 'react'
import type { IBYOKProvider } from '../../lib/copilot/byok'
import { isGHES } from '../../lib/endpoint-capabilities'
import {
  type CopilotFeature,
  type CopilotModelSelections,
  type CopilotQuotaSnapshots,
} from '../../lib/stores/copilot-store'
import type { Account } from '../../models/account'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { CallToAction } from '../lib/call-to-action'
import type { Model } from '@github/copilot-sdk/dist/generated/rpc'
import { CopilotUserSettings } from './copilot-user-settings'

interface ICopilotPreferencesProps {
  readonly selectedCopilotModels: CopilotModelSelections
  readonly copilotModels: ReadonlyArray<Model> | null
  readonly copilotQuotaSnapshots: CopilotQuotaSnapshots | null
  readonly accounts: ReadonlyArray<Account>
  readonly byokProviders: ReadonlyArray<IBYOKProvider>
  readonly showBYOKSettings: boolean
  readonly onSignIn: () => void
  readonly onOpenCopilotPlans: () => void
  readonly onOpenCopilotFeatureSettings: () => void
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
}

type CopilotAccessState =
  | 'signed-out'
  | 'checking'
  | 'no-license'
  | 'desktop-disabled'

const CopilotLicenseTypeNoAccess = 'NO_ACCESS'
export class CopilotPreferences extends React.Component<ICopilotPreferencesProps> {
  public render() {
    const account = this.getCopilotSettingsAccount()

    if (account !== undefined) {
      return (
        <DialogContent className="copilot-tab">
          {this.renderUserSettings(account)}
        </DialogContent>
      )
    }

    const accessState = this.getCopilotAccessState()

    return (
      <DialogContent className="copilot-tab">
        <div className="copilot-tab-content">
          <div className="copilot-section">
            {this.renderAccessState(accessState)}
          </div>
        </div>
      </DialogContent>
    )
  }

  private renderUserSettings(account: Account): JSX.Element {
    return (
      <CopilotUserSettings
        account={account}
        selectedCopilotModels={this.props.selectedCopilotModels}
        copilotModels={this.props.copilotModels}
        copilotQuotaSnapshots={this.props.copilotQuotaSnapshots}
        byokProviders={this.props.byokProviders}
        showBYOKSettings={this.props.showBYOKSettings}
        alwaysUseCopilotForConflictResolution={
          this.props.alwaysUseCopilotForConflictResolution
        }
        onSelectedCopilotModelChanged={this.props.onSelectedCopilotModelChanged}
        onAlwaysUseCopilotForConflictResolutionChanged={
          this.props.onAlwaysUseCopilotForConflictResolutionChanged
        }
        onAddBYOKProvider={this.props.onAddBYOKProvider}
        onEditBYOKProvider={this.props.onEditBYOKProvider}
        onDeleteBYOKProvider={this.props.onDeleteBYOKProvider}
      />
    )
  }

  private getCopilotAccounts(): ReadonlyArray<Account> {
    return this.props.accounts.filter(account => !isGHES(account.endpoint))
  }

  private getCopilotSettingsAccount(): Account | undefined {
    return this.getCopilotAccounts().find(
      account =>
        account.isCopilotDesktopEnabled === true &&
        account.copilotLicenseType !== undefined &&
        account.copilotLicenseType !== CopilotLicenseTypeNoAccess
    )
  }

  private getCopilotAccessState(): CopilotAccessState {
    const accounts = this.getCopilotAccounts()

    if (accounts.length === 0) {
      return 'signed-out'
    }

    let hasCheckingAccount = false
    let hasNoAccessAccount = false
    let hasDesktopDisabledAccount = false

    for (const account of accounts) {
      if (
        account.copilotLicenseType === undefined ||
        account.isCopilotDesktopEnabled === undefined
      ) {
        hasCheckingAccount = true
      } else if (account.copilotLicenseType === CopilotLicenseTypeNoAccess) {
        hasNoAccessAccount = true
      } else if (account.isCopilotDesktopEnabled === false) {
        hasDesktopDisabledAccount = true
      }
    }

    if (hasCheckingAccount) {
      return 'checking'
    }

    if (hasDesktopDisabledAccount) {
      return 'desktop-disabled'
    }

    if (hasNoAccessAccount) {
      return 'no-license'
    }

    return 'checking'
  }

  private renderAccessState(accessState: CopilotAccessState): JSX.Element {
    switch (accessState) {
      case 'signed-out':
        return this.renderAccessCallToAction(
          'Sign in to an account with a Copilot license to configure Copilot settings.',
          'Sign In',
          this.props.onSignIn,
          DialogPreferredFocusClassName
        )
      case 'checking':
        return <p>Checking Copilot access…</p>
      case 'no-license':
        return this.renderAccessCallToAction(
          'Copilot features in GitHub Desktop require a GitHub Copilot license.',
          'View Copilot plans',
          this.props.onOpenCopilotPlans
        )
      case 'desktop-disabled':
        return this.renderAccessCallToAction(
          'A Copilot license is available for your account, but "Copilot in GitHub Desktop" is disabled in your Copilot feature settings.',
          'Open Copilot feature settings',
          this.props.onOpenCopilotFeatureSettings
        )
    }
  }

  private renderAccessCallToAction(
    message: string,
    actionTitle: string,
    onAction: () => void,
    buttonClassName?: string
  ): JSX.Element {
    return (
      <div className="copilot-access-call-to-action">
        <CallToAction
          actionTitle={actionTitle}
          onAction={onAction}
          buttonClassName={buttonClassName}
        >
          <div>{message}</div>
        </CallToAction>
      </div>
    )
  }
}
