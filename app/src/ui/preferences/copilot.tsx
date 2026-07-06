import * as React from 'react'
import type { IBYOKProvider } from '../../lib/copilot/byok'
import { isGHES } from '../../lib/endpoint-capabilities'
import {
  type CopilotFeature,
  getCopilotAccountCacheKey,
  type CopilotModelsByAccount,
  type CopilotModelSelections,
  type CopilotQuotaSnapshotsByAccount,
  type CopilotQuotaSnapshots,
} from '../../lib/stores/copilot-store'
import type { Account } from '../../models/account'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { CallToAction } from '../lib/call-to-action'
import type { Model } from '@github/copilot-sdk/dist/generated/rpc'
import { CopilotSettingsDialog } from './copilot-settings-dialog'
import { CopilotUserSettings } from './copilot-user-settings'
import { SnapshotCard } from './snapshot-card'

interface ICopilotPreferencesProps {
  readonly selectedCopilotModels: CopilotModelSelections
  readonly copilotModels: ReadonlyArray<Model> | null
  readonly copilotModelsByAccount: CopilotModelsByAccount
  readonly copilotQuotaSnapshots: CopilotQuotaSnapshots | null
  readonly copilotQuotaSnapshotsByAccount: CopilotQuotaSnapshotsByAccount
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

interface ICopilotPreferencesState {
  readonly configuringAccount: Account | null
}

type CopilotAccessState =
  | 'signed-out'
  | 'checking'
  | 'no-license'
  | 'desktop-disabled'

const CopilotLicenseTypeNoAccess = 'NO_ACCESS'
export class CopilotPreferences extends React.Component<
  ICopilotPreferencesProps,
  ICopilotPreferencesState
> {
  public constructor(props: ICopilotPreferencesProps) {
    super(props)

    this.state = {
      configuringAccount: null,
    }
  }

  public render() {
    const accounts = this.getCopilotSettingsAccounts()

    if (accounts.length === 1) {
      return (
        <DialogContent className="copilot-tab">
          {this.renderUserSettings(accounts[0])}
        </DialogContent>
      )
    }

    if (accounts.length > 1) {
      return (
        <>
          <DialogContent className="copilot-tab">
            {this.renderAccountSnapshotCards(accounts)}
          </DialogContent>
          {this.renderCopilotSettingsDialog()}
        </>
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
        copilotModels={this.getCopilotModels(account)}
        copilotQuotaSnapshots={this.getCopilotQuotaSnapshots(account)}
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

  private renderAccountSnapshotCards(
    accounts: ReadonlyArray<Account>
  ): JSX.Element {
    return (
      <div className="copilot-tab-content">
        <div className="copilot-section">
          <div className="copilot-account-snapshot-card-list">
            {accounts.map(account => (
              <SnapshotCard
                key={getCopilotAccountCacheKey(account)}
                account={account}
                snapshots={this.getCopilotQuotaSnapshots(account)}
                onConfigureModels={this.onConfigureModels}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  private renderCopilotSettingsDialog(): JSX.Element | null {
    const account = this.state.configuringAccount

    if (account === null) {
      return null
    }

    return (
      <CopilotSettingsDialog
        key={getCopilotAccountCacheKey(account)}
        account={account}
        selectedCopilotModels={this.props.selectedCopilotModels}
        copilotModels={this.getCopilotModels(account)}
        copilotQuotaSnapshots={this.getCopilotQuotaSnapshots(account)}
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
        onDismissed={this.onDismissCopilotSettingsDialog}
      />
    )
  }

  private onConfigureModels = (account: Account) => {
    this.setState({ configuringAccount: account })
  }

  private onDismissCopilotSettingsDialog = () => {
    this.setState({ configuringAccount: null })
  }

  private getCopilotAccounts(): ReadonlyArray<Account> {
    return this.props.accounts.filter(account => !isGHES(account.endpoint))
  }

  private getCopilotSettingsAccounts(): ReadonlyArray<Account> {
    return this.getCopilotAccounts().filter(
      account =>
        account.isCopilotDesktopEnabled === true &&
        account.copilotLicenseType !== undefined &&
        account.copilotLicenseType !== CopilotLicenseTypeNoAccess
    )
  }

  private getCopilotModels(account: Account): ReadonlyArray<Model> | null {
    const key = getCopilotAccountCacheKey(account)

    if (this.props.copilotModelsByAccount.has(key)) {
      return this.props.copilotModelsByAccount.get(key) ?? null
    }

    return this.props.copilotModels
  }

  private getCopilotQuotaSnapshots(
    account: Account
  ): CopilotQuotaSnapshots | null {
    const key = getCopilotAccountCacheKey(account)

    if (this.props.copilotQuotaSnapshotsByAccount.has(key)) {
      return this.props.copilotQuotaSnapshotsByAccount.get(key) ?? null
    }

    return this.props.copilotQuotaSnapshots
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
