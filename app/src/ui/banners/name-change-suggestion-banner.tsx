import * as React from 'react'
import { Banner } from './banner'
import { setBoolean } from '../../lib/local-storage'
import { LinkButton } from '../lib/link-button'

export const NameChangeSuggestionBannerShownKey =
  'name-change-suggestion-banner-shown'

const DiscussionUrl =
  'https://github.com/DesktopPlus/desktop-plus/discussions/140'

export class NameChangeSuggestionBanner extends React.Component<{
  onDismissed: () => void
}> {
  private onDismissed = () => {
    setBoolean(NameChangeSuggestionBannerShownKey, true)
    this.props.onDismissed()
  }

  public render() {
    return (
      <Banner
        id="name-change-suggestion-banner"
        dismissable={true}
        onDismissed={this.onDismissed}
      >
        <span>
          <strong>Got a minute?</strong> We&apos;re renaming the app and
          updating its logo.{' '}
          <LinkButton uri={DiscussionUrl} onClick={this.onDismissed}>
            Submit your suggestions and vote for your favorites!
          </LinkButton>
        </span>
      </Banner>
    )
  }
}
