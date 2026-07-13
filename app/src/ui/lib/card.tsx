import * as React from 'react'
import classNames from 'classnames'

interface ICardProps {
  /** Optional header region, above the body. */
  readonly header?: React.ReactNode

  /** Optional footer region, below the body. */
  readonly footer?: React.ReactNode

  /** The body. */
  readonly children?: React.ReactNode

  /**
   * If given, the whole card is activatable, and is rendered as a real
   * `<button>` — never a `<div onClick>`. A clickable div is unreachable by
   * keyboard and invisible to assistive tech; a control center whose cards you
   * cannot tab to is broken for anyone not holding a mouse.
   */
  readonly onClick?: () => void

  /** The accessible name, used when the card is clickable. */
  readonly ariaLabel?: string

  readonly className?: string
}

/**
 * A surface with an optional header, a body, and an optional footer. Static by
 * default; a `<button>` the moment it is given an `onClick`. `home-view`'s
 * stats and project cards are the first consumers.
 */
export class Card extends React.Component<ICardProps> {
  public render() {
    const clickable = this.props.onClick !== undefined
    const className = classNames(
      'card',
      { 'card--clickable': clickable },
      this.props.className
    )

    // Spans, not divs: the clickable card is a <button>, whose content model is
    // phrasing content, and a <div> inside a <button> is invalid. `display:flex`
    // in the stylesheet gives them the block layout they need regardless.
    const content = (
      <>
        {this.props.header !== undefined && (
          <span className="card-header">{this.props.header}</span>
        )}
        <span className="card-body">{this.props.children}</span>
        {this.props.footer !== undefined && (
          <span className="card-footer">{this.props.footer}</span>
        )}
      </>
    )

    if (clickable) {
      return (
        <button
          className={className}
          onClick={this.props.onClick}
          aria-label={this.props.ariaLabel}
        >
          {content}
        </button>
      )
    }

    return <div className={className}>{content}</div>
  }
}
