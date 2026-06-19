import * as React from 'react'
import {
  encodeModelKey,
  isLocalBaseUrl,
  parseModelKey,
  type IBYOKProvider,
} from '../../lib/copilot/byok'
import { enableCopilotConflictResolution } from '../../lib/feature-flag'
import {
  DefaultCopilotModel,
  type CopilotFeature,
  type CopilotModelSelections,
  type CopilotQuotaSnapshots,
} from '../../lib/stores/copilot-store'
import type { Account } from '../../models/account'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  CopilotModelPicker,
  getCopilotModelPickerSelectionInfo,
  hasCopilotModelPickerItems,
} from '../lib/copilot-model-picker'
import { LinkButton } from '../lib/link-button'
import { Row } from '../lib/row'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TabBar } from '../tab-bar'
import { CopilotModelSelectionInfo } from './copilot-model-selection-info'
import { SnapshotCard } from './snapshot-card'
import type { Model } from '@github/copilot-sdk/dist/generated/rpc'

interface ICopilotUserSettingsProps {
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
}

interface ICopilotUserSettingsState {
  readonly selectedTabIndex: number
}

/** User-configurable Copilot settings with optional provider management. */
export class CopilotUserSettings extends React.Component<
  ICopilotUserSettingsProps,
  ICopilotUserSettingsState
> {
  public constructor(props: ICopilotUserSettingsProps) {
    super(props)
    this.state = { selectedTabIndex: 0 }
  }

  private onCommitMessageModelChanged = (model: string) => {
    this.props.onSelectedCopilotModelChanged('commit-message-generation', model)
  }

  private onConflictResolutionModelChanged = (model: string) => {
    this.props.onSelectedCopilotModelChanged('conflict-resolution', model)
  }

  private onAlwaysUseCopilotForConflictResolutionChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAlwaysUseCopilotForConflictResolutionChanged(
      event.currentTarget.checked
    )
  }

  private onAddBYOKProviderClick = () => this.props.onAddBYOKProvider()

  private onEditBYOKProviderClick = (provider: IBYOKProvider) => () =>
    this.props.onEditBYOKProvider(provider)

  private onDeleteBYOKProviderClick = (provider: IBYOKProvider) => () =>
    this.props.onDeleteBYOKProvider(provider)

  private onTabClicked = (index: number) => {
    this.setState({ selectedTabIndex: index })
  }

  public render() {
    if (!this.props.showBYOKSettings) {
      return this.renderContent(this.renderModelPicker())
    }

    return (
      <>
        <TabBar
          selectedIndex={this.state.selectedTabIndex}
          onTabClicked={this.onTabClicked}
        >
          <span>Models</span>
          <span>Providers</span>
        </TabBar>
        {this.renderContent(this.renderCurrentTab())}
      </>
    )
  }

  private renderCurrentTab(): JSX.Element {
    if (this.state.selectedTabIndex === 1) {
      return this.renderBYOKProviders()
    }

    return this.renderModelPicker()
  }

  private renderContent(content: JSX.Element): JSX.Element {
    return (
      <div className="copilot-tab-content">
        <div className="copilot-section">
          {content}
          {this.renderUsage()}
        </div>
      </div>
    )
  }

  private renderModelPicker(): JSX.Element {
    const { copilotModels, byokProviders } = this.props

    if (copilotModels === null) {
      return <p>Loading available models…</p>
    }

    if (!hasCopilotModelPickerItems(copilotModels, byokProviders)) {
      return <p>No Copilot models available.</p>
    }

    return (
      <>
        <Row className="copilot-feature-hint">
          <p>
            Tailor how Copilot behaves by using{' '}
            <LinkButton uri="https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions">
              custom instructions
            </LinkButton>
            .
          </p>
        </Row>
        {this.renderFeatureModelPicker(
          copilotModels,
          'commit-message-generation',
          __DARWIN__
            ? 'Commit Message Generation'
            : 'Commit message generation',
          this.onCommitMessageModelChanged
        )}
        <p className="settings-description">
          <LinkButton uri="https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop#write-a-commit-message-and-push-your-changes">
            Learn more about generating commit messages.
          </LinkButton>
        </p>
        {enableCopilotConflictResolution() && (
          <>
            {this.renderFeatureModelPicker(
              copilotModels,
              'conflict-resolution',
              __DARWIN__ ? 'Conflict Resolution' : 'Conflict resolution',
              this.onConflictResolutionModelChanged
            )}
            <p className="settings-description">
              Model changes apply to future conflict resolutions.
            </p>
            <Checkbox
              label={
                __DARWIN__
                  ? 'Always Use Copilot When Conflicts Are Detected'
                  : 'Always use Copilot when conflicts are detected'
              }
              value={
                this.props.alwaysUseCopilotForConflictResolution
                  ? CheckboxValue.On
                  : CheckboxValue.Off
              }
              onChange={this.onAlwaysUseCopilotForConflictResolutionChanged}
            />
          </>
        )}
      </>
    )
  }

  private renderUsage(): JSX.Element {
    return (
      <div className="copilot-usage-section">
        <h2>Usage</h2>
        <SnapshotCard
          account={this.props.account}
          snapshots={this.props.copilotQuotaSnapshots}
        />
      </div>
    )
  }

  private renderFeatureModelPicker(
    copilotModels: ReadonlyArray<Model>,
    feature: CopilotFeature,
    label: string,
    onChange: (model: string) => void
  ): JSX.Element {
    const { byokProviders, selectedCopilotModels } = this.props

    const rawSelection = selectedCopilotModels[feature] ?? null
    const value = this.resolveSelectionValue(
      copilotModels,
      byokProviders,
      rawSelection
    )
    const selectionInfo = getCopilotModelPickerSelectionInfo(
      copilotModels,
      value
    )

    return (
      <>
        <CopilotModelPicker
          label={label}
          copilotModels={copilotModels}
          byokProviders={byokProviders}
          value={value}
          onChange={onChange}
        />
        {selectionInfo === null ? null : (
          <CopilotModelSelectionInfo
            feature={feature}
            selectionInfo={selectionInfo}
          />
        )}
      </>
    )
  }

  private resolveSelectionValue(
    copilotModels: ReadonlyArray<Model>,
    byokProviders: ReadonlyArray<IBYOKProvider>,
    raw: string | null
  ): string {
    if (raw !== null) {
      const key = parseModelKey(raw)
      if (key.kind === 'byok') {
        const provider = byokProviders.find(p => p.id === key.providerId)
        if (provider && provider.models.some(m => m.id === key.modelId)) {
          return encodeModelKey(key)
        }
      } else if (
        key.modelId !== '' &&
        copilotModels.some(m => m.id === key.modelId)
      ) {
        return encodeModelKey({ kind: 'copilot', modelId: key.modelId })
      }
    }

    return this.getFirstSelectableModelValue(copilotModels, byokProviders)
  }

  private getFirstSelectableModelValue(
    copilotModels: ReadonlyArray<Model>,
    byokProviders: ReadonlyArray<IBYOKProvider>
  ): string {
    if (copilotModels.length === 0 && byokProviders.length === 0) {
      // This should not happen because we check for this case earlier, but let's
      // make that assumption explicit and crash if it is violated rather than
      // returning null.
      throw new Error('No models available')
    }

    const preferredCopilotModel = copilotModels.find(
      m => m.id === DefaultCopilotModel
    )
    if (preferredCopilotModel !== undefined) {
      return encodeModelKey({
        kind: 'copilot',
        modelId: preferredCopilotModel.id,
      })
    }

    const firstCopilotModel = copilotModels[0]
    if (firstCopilotModel !== undefined) {
      return encodeModelKey({ kind: 'copilot', modelId: firstCopilotModel.id })
    }

    const firstProvider = byokProviders.find(provider => provider.models[0])

    if (firstProvider === undefined) {
      // This should not happen because we check for selectable models earlier.
      throw new Error('No models available')
    }

    const firstByokModel = firstProvider.models[0]
    return encodeModelKey({
      kind: 'byok',
      providerId: firstProvider.id,
      modelId: firstByokModel.id,
    })
  }

  private renderBYOKProviders(): JSX.Element {
    const { byokProviders } = this.props
    return (
      <>
        {byokProviders.length === 0 ? (
          <p className="copilot-byok-empty">
            Add a custom provider to use your own API keys with
            OpenAI-compatible endpoints, Azure, Anthropic, or local providers
            like Ollama.
          </p>
        ) : (
          <ul className="copilot-byok-entry-list">
            {byokProviders.map(this.renderBYOKProvider)}
          </ul>
        )}
        <Button onClick={this.onAddBYOKProviderClick}>
          {__DARWIN__ ? 'Add Provider…' : 'Add provider…'}
        </Button>
      </>
    )
  }

  private renderBYOKProvider = (provider: IBYOKProvider) => {
    const modelCount = provider.models.length
    const modelLabel = modelCount === 1 ? '1 model' : `${modelCount} models`
    const isLocal = isLocalBaseUrl(provider.baseUrl)
    return (
      <li key={provider.id} className="copilot-byok-entry">
        <div className="copilot-byok-entry-info">
          <div className="copilot-byok-entry-title">
            <span>{provider.name}</span>
            {isLocal && (
              <span className="copilot-byok-provider-badge">Local</span>
            )}
          </div>
          <span className="copilot-byok-entry-meta">
            {this.formatProviderType(provider)} · {modelLabel}
          </span>
        </div>
        <div className="copilot-byok-entry-actions">
          <Button
            onClick={this.onEditBYOKProviderClick(provider)}
            ariaLabel={`Edit ${provider.name}`}
          >
            <Octicon symbol={octicons.pencil} />
          </Button>
          <Button
            onClick={this.onDeleteBYOKProviderClick(provider)}
            ariaLabel={`Remove ${provider.name}`}
          >
            <Octicon symbol={octicons.trash} />
          </Button>
        </div>
      </li>
    )
  }

  private formatProviderType(provider: IBYOKProvider): string {
    switch (provider.type) {
      case 'openai':
        return 'OpenAI-compatible'
      case 'azure':
        return 'Azure'
      case 'anthropic':
        return 'Anthropic'
    }
  }
}
