import * as React from 'react'
import { formatBytes } from '../lib/bytes'
import { IDocFile } from '../../models/workspace-inventory'
import { plural } from './display'

interface IDocFileItemProps {
  readonly doc: IDocFile
  readonly onOpen: (relativePath: string) => void
}

class DocFileItem extends React.Component<IDocFileItemProps> {
  private onClick = () => this.props.onOpen(this.props.doc.relativePath)

  public render() {
    const { doc } = this.props

    return (
      <li className="workspace-file">
        <button className="workspace-file-path" onClick={this.onClick}>
          {doc.relativePath}
        </button>
        <span className="workspace-file-meta">
          {doc.title !== null && (
            <span className="workspace-file-name">{doc.title}</span>
          )}
          <span>
            {doc.lineCount} {plural(doc.lineCount, 'line')}
          </span>
          <span>{formatBytes(doc.byteLength)}</span>
        </span>
      </li>
    )
  }
}

interface IDocFileListProps {
  readonly docs: ReadonlyArray<IDocFile>
  readonly onOpen: (relativePath: string) => void
}

export class DocFileList extends React.Component<IDocFileListProps> {
  public render() {
    if (this.props.docs.length === 0) {
      return (
        <div className="workspace-detail">
          <p className="workspace-empty">No documentation.</p>
        </div>
      )
    }

    return (
      <div className="workspace-detail">
        <ul className="workspace-files">
          {this.props.docs.map(doc => (
            <DocFileItem
              key={doc.relativePath}
              doc={doc}
              onOpen={this.props.onOpen}
            />
          ))}
        </ul>
      </div>
    )
  }
}
