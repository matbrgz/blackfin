import * as React from 'react'
import { Resizable } from '../resizable/resizable'
import { FocusContainer } from './focus-container'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IDetailPaneProps {
  /** The heading, which also names the region for assistive tech. */
  readonly title: string

  /** If given, a close control is shown. */
  readonly onClose?: () => void

  readonly children: React.ReactNode

  /** Starting width in px. */
  readonly defaultWidth?: number
  readonly minimumWidth?: number
  readonly maximumWidth?: number

  readonly id?: string
}

interface IDetailPaneState {
  /** The pane's width. Local UI state — the pane persists nothing. */
  readonly width: number
}

const DefaultWidth = 320
const DefaultMinimumWidth = 240
const DefaultMaximumWidth = 640

/**
 * The detail of a thing — an extension, an MCP server, a worktree — shown *in
 * the flow*, beside the list, not over it.
 *
 * Deliberately not a drawer. The detail is where the user settles, and a
 * control center exists to *compare across projects*; a modal drawer would
 * cover the list it is meant to be read against. So this is a `Resizable`
 * region inside the same view as the list — non-modal, the list still visible,
 * scrollable and comparable. Where a genuinely transient overlay is the answer,
 * the component is `Popover` with `trapFocus`, not this.
 *
 * It docks on the right, so its resize handle is on its inner (left) edge.
 * Focus restoration on open and close is defined by #20.
 */
export class DetailPane extends React.Component<
  IDetailPaneProps,
  IDetailPaneState
> {
  private readonly titleId = `${this.props.id ?? 'detail-pane'}-title`

  public constructor(props: IDetailPaneProps) {
    super(props)
    this.state = { width: props.defaultWidth ?? DefaultWidth }
  }

  private onResize = (width: number): void => {
    this.setState({ width })
  }

  private onReset = (): void => {
    this.setState({ width: this.props.defaultWidth ?? DefaultWidth })
  }

  public render() {
    return (
      <Resizable
        id={this.props.id}
        width={this.state.width}
        minimumWidth={this.props.minimumWidth ?? DefaultMinimumWidth}
        maximumWidth={this.props.maximumWidth ?? DefaultMaximumWidth}
        onResize={this.onResize}
        onReset={this.onReset}
        handleSide="left"
        description="Detail pane"
      >
        <FocusContainer className="detail-pane">
          <section className="detail-pane-inner" aria-labelledby={this.titleId}>
            <header className="detail-pane-header">
              <h2 className="detail-pane-title" id={this.titleId}>
                {this.props.title}
              </h2>
              {this.props.onClose !== undefined && (
                <button
                  className="detail-pane-close"
                  onClick={this.props.onClose}
                  aria-label="Close detail pane"
                >
                  <Octicon symbol={octicons.x} />
                </button>
              )}
            </header>
            <div className="detail-pane-body">{this.props.children}</div>
          </section>
        </FocusContainer>
      </Resizable>
    )
  }
}
