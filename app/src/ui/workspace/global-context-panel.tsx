import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  IGlobalContext,
  brokenReferences,
} from '../../models/workspace-inventory'
import { ContextFileList } from './context-file-list'
import { plural } from './display'

interface IGlobalContextPanelProps {
  readonly context: IGlobalContext
  readonly onOpenFile: (absolutePath: string) => void
}

/**
 * The agent context living in the user's home directory.
 *
 * This is the screen nothing else in the toolchain gives you. A rule in
 * `~/.claude/CLAUDE.md` reaches every repository you touch and is invisible from
 * inside all of them — so when an agent does something surprising in one
 * project, the cause is often a file that project has never heard of.
 */
export class GlobalContextPanel extends React.Component<IGlobalContextPanelProps> {
  private onOpen = (relativePath: string) => {
    this.props.onOpenFile(`${this.props.context.homePath}/${relativePath}`)
  }

  public render() {
    const { context } = this.props

    if (context.status.kind === 'error') {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">{context.status.message}</p>
        </div>
      )
    }

    if (context.contextFiles.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">
            No agent context in your home directory. Nothing applies across all
            of your projects.
          </p>
        </div>
      )
    }

    const broken = brokenReferences({
      repositoryId: -1,
      repositoryPath: context.homePath,
      scannedAt: context.scannedAt,
      status: context.status,
      contextFiles: context.contextFiles,
      docs: [],
      artifacts: [],
    })

    return (
      <div className="workspace-global">
        <p className="workspace-global-note">
          <Octicon symbol={octicons.globe} />
          These apply to <strong>every project</strong> on this machine, and are
          invisible from inside any of them.
          {broken.length > 0 && (
            <span className="workspace-badge error">
              {broken.length} broken {plural(broken.length, 'reference')}
            </span>
          )}
        </p>

        <div className="workspace-detail">
          <ContextFileList files={context.contextFiles} onOpen={this.onOpen} />
        </div>
      </div>
    )
  }
}
