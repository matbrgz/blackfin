import * as React from 'react'
import * as Path from 'path'
import { Dialog, DialogContent } from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { shell } from '../../lib/app-shell'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Loading } from '../lib/loading'
import { readPartialFile } from '../../lib/file-system'
import { highlight } from '../../lib/highlighter/worker'
import { ITokens } from '../../lib/highlighter/types'
import { syntaxHighlightLine } from '../diff/diff-helpers'
import {
  MaxReaderContentLength,
  allLineIndices,
  decodeContentLines,
  isProbablyBinary,
} from '../../lib/workspace/context-file-content'

// The diff highlighter tokenises with a fixed four-space tab; the reader shares
// the look, so it shares the width.
const TabSize = 4

/**
 * What the reader has to show, once it has been back to disk for the bytes the
 * scan never kept. Every outcome that isn't "here are the lines" is a state to
 * render, not an error to throw: a context file that was deleted between the
 * scan and the click is an ordinary thing, and the modal saying so is more
 * useful than the app falling over.
 */
type ReaderContent =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'binary' }
  | {
      readonly kind: 'text'
      readonly lines: ReadonlyArray<string>
      readonly tokens: ITokens
    }

interface IContextFileReaderDialogProps {
  readonly dispatcher: Dispatcher

  /** The absolute path to read the file from. */
  readonly absolutePath: string

  /**
   * The path as it should read in the header — the repository- or home-relative
   * path the inventory recorded, which is what the user clicked on.
   */
  readonly displayPath: string

  /**
   * The repository the file lives in, or null for a global context file. It
   * decides how "open externally" behaves — the external editor for a project
   * file, the system file manager for a global one, exactly as clicking did
   * before this reader existed.
   */
  readonly repository: Repository | null

  readonly onDismissed: () => void
}

interface IContextFileReaderDialogState {
  readonly content: ReaderContent
}

/**
 * A read-only reader for a single agent-context file, wearing the diff's
 * clothes: the same monospace body, gutter numbers and syntax colours, so a
 * `CLAUDE.md` reads here the way its edits read in the diff. It is a viewer, not
 * an editor — the intent is to *see* what an agent sees, in place, without
 * leaving for an external app.
 */
export class ContextFileReaderDialog extends React.Component<
  IContextFileReaderDialogProps,
  IContextFileReaderDialogState
> {
  private mounted = false

  public constructor(props: IContextFileReaderDialogProps) {
    super(props)
    this.state = { content: { kind: 'loading' } }
  }

  public async componentDidMount() {
    this.mounted = true
    await this.load()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private async load() {
    let content: ReaderContent

    try {
      const buffer = await readPartialFile(
        this.props.absolutePath,
        0,
        MaxReaderContentLength - 1
      )

      if (isProbablyBinary(buffer)) {
        content = { kind: 'binary' }
      } else {
        const lines = decodeContentLines(buffer)
        const tokens = await this.highlightLines(lines)
        content = { kind: 'text', lines, tokens }
      }
    } catch {
      // A read that fails is very nearly always the file having been moved or
      // deleted since the scan; either way there is nothing to show, and that
      // is a state rather than a crash.
      content = { kind: 'missing' }
    }

    if (this.mounted) {
      this.setState({ content })
    }
  }

  private async highlightLines(lines: ReadonlyArray<string>): Promise<ITokens> {
    try {
      return await highlight(
        lines,
        Path.basename(this.props.absolutePath),
        Path.extname(this.props.absolutePath),
        TabSize,
        allLineIndices(lines.length)
      )
    } catch {
      // Highlighting is decoration. If the worker gives up we still show the
      // text, just without colour.
      return {}
    }
  }

  private onOpenExternally = () => {
    const { repository, absolutePath } = this.props
    if (repository !== null) {
      this.props.dispatcher.openInExternalEditor(repository, absolutePath)
    } else {
      shell.showItemInFolder(absolutePath)
    }
  }

  private renderHeaderAccessory = () => {
    return (
      <Button
        className="context-file-reader-open-externally"
        onClick={this.onOpenExternally}
        ariaLabel="Open externally"
      >
        <Octicon symbol={octicons.linkExternal} />
      </Button>
    )
  }

  private renderBody() {
    const { content } = this.state

    switch (content.kind) {
      case 'loading':
        return (
          <div className="context-file-reader-message">
            <Loading /> Loading…
          </div>
        )
      case 'missing':
        return (
          <div className="context-file-reader-message">
            This file no longer exists on disk.
          </div>
        )
      case 'binary':
        return (
          <div className="context-file-reader-message">
            This looks like a binary file and can’t be shown here.
          </div>
        )
      case 'text':
        return this.renderText(content.lines, content.tokens)
    }
  }

  private renderText(lines: ReadonlyArray<string>, tokens: ITokens) {
    return (
      <div
        className="context-file-reader-code cm-s-default"
        role="presentation"
      >
        {lines.map((line, index) => {
          const lineTokens = tokens[index]
          return (
            <div className="context-file-reader-line" key={index}>
              <span className="context-file-reader-gutter diff-line-number">
                {index + 1}
              </span>
              <span className="context-file-reader-line-content">
                {syntaxHighlightLine(
                  line,
                  lineTokens !== undefined ? [lineTokens] : []
                )}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  public render() {
    return (
      <Dialog
        id="context-file-reader"
        className="context-file-reader"
        title={this.props.displayPath}
        loading={this.state.content.kind === 'loading'}
        renderHeaderAccessory={this.renderHeaderAccessory}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>{this.renderBody()}</DialogContent>
      </Dialog>
    )
  }
}
