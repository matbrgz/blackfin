import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { AgentId, IContextFile } from '../../models/workspace-inventory'
import { agentDisplayName } from '../../lib/workspace/catalog'
import { plural, roleDisplayName } from './display'

/**
 * A list of agent-context files, grouped by the agent that reads them. Used for
 * both the global context and each project's, which is the point — the same
 * file means the same thing wherever it lives, and only its reach differs.
 */

interface IContextFileItemProps {
  readonly file: IContextFile
  readonly onOpen: (relativePath: string) => void
}

class ContextFileItem extends React.Component<IContextFileItemProps> {
  private onClick = () => this.props.onOpen(this.props.file.relativePath)

  public render() {
    const { file } = this.props
    const broken = file.references.filter(r => !r.exists)

    return (
      <li className="workspace-file">
        <button className="workspace-file-path" onClick={this.onClick}>
          {file.relativePath}
        </button>

        <span className="workspace-file-meta">
          <span className="workspace-role">{roleDisplayName(file.role)}</span>
          {file.name !== null && (
            <span className="workspace-file-name">{file.name}</span>
          )}
          {file.ruleCount > 0 && (
            <span>
              {file.ruleCount} {plural(file.ruleCount, 'rule')}
            </span>
          )}
          <span>{formatBytes(file.byteLength)}</span>
        </span>

        {file.description !== null && (
          <p className="workspace-file-description">{file.description}</p>
        )}

        {file.skippedReason !== null && (
          <p className="workspace-file-skipped">{file.skippedReason}</p>
        )}

        {broken.length > 0 && (
          <ul className="workspace-broken">
            {broken.map(reference => (
              <li key={reference.target}>
                <Octicon symbol={octicons.alert} />
                Points at <code>{reference.target}</code>, which does not exist
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }
}

interface IContextFileListProps {
  readonly files: ReadonlyArray<IContextFile>
  readonly onOpen: (relativePath: string) => void
}

export class ContextFileList extends React.Component<IContextFileListProps> {
  public render() {
    const byAgent = new Map<AgentId, Array<IContextFile>>()

    for (const file of this.props.files) {
      const group = byAgent.get(file.agent) ?? []
      group.push(file)
      byAgent.set(file.agent, group)
    }

    return (
      <>
        {[...byAgent].map(([agent, files]) => (
          <div key={agent} className="workspace-agent-group">
            <h3>{agentDisplayName(agent)}</h3>
            <ul className="workspace-files">
              {files.map(file => (
                <ContextFileItem
                  key={file.relativePath}
                  file={file}
                  onOpen={this.props.onOpen}
                />
              ))}
            </ul>
          </div>
        ))}
      </>
    )
  }
}
