import * as React from 'react'
import { SuccessBanner } from './success-banner'

interface IConfigDirMigratedBannerProps {
  readonly migratedFromAppName: string
  readonly onDismissed: () => void
}

export class ConfigDirMigratedBanner extends React.Component<IConfigDirMigratedBannerProps> {
  public render() {
    return (
      <SuccessBanner timeout={15000} onDismissed={this.props.onDismissed}>
        Your settings from <strong>{this.props.migratedFromAppName}</strong>{' '}
        were migrated successfully.
      </SuccessBanner>
    )
  }
}
