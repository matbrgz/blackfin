import * as React from 'react'
import { List } from '../list'
import { ITreeRowMetadata } from '../list/list-row'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import {
  ITreeNode,
  IFlatTreeRow,
  flattenTree,
  nearestVisibleId,
} from './flatten'

export { ITreeNode } from './flatten'

interface ITreeRowProps<T> {
  readonly row: IFlatTreeRow<T>
  readonly onToggle: (id: string) => void
  readonly renderNode: (node: ITreeNode<T>) => JSX.Element
}

/**
 * The content of one tree row: an indent, a twisty for parents, and whatever
 * the consumer renders for the node. The row's *semantics* — `role="treeitem"`,
 * `aria-level`, `aria-expanded`, set position — live on `List`'s row div, so
 * the twisty is a mouse affordance only: it is hidden from assistive tech,
 * which drives expansion through the row's `aria-expanded` and the arrow keys.
 */
class TreeRow<T> extends React.Component<ITreeRowProps<T>> {
  private onToggleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Toggle without also dragging selection around under the mouse.
    e.stopPropagation()
    this.props.onToggle(this.props.row.node.id)
  }

  public render() {
    const { row } = this.props

    return (
      <div
        className="tree-row"
        style={{ paddingLeft: `calc(${row.level - 1} * var(--space-4))` }}
      >
        {row.hasChildren ? (
          <button
            className="tree-twisty"
            onClick={this.onToggleClick}
            tabIndex={-1}
            aria-hidden={true}
          >
            <Octicon
              symbol={
                row.expanded ? octicons.chevronDown : octicons.chevronRight
              }
            />
          </button>
        ) : (
          <span className="tree-twisty tree-twisty--leaf" aria-hidden={true} />
        )}
        {this.props.renderNode(row.node)}
      </div>
    )
  }
}

interface ITreeProps<T> {
  /** The forest. */
  readonly roots: ReadonlyArray<ITreeNode<T>>

  /** Renders the content of a node. Never receives tree mechanics — just data. */
  readonly renderNode: (node: ITreeNode<T>) => JSX.Element

  /** Row height, in px. Defaults to the density row height. */
  readonly rowHeight?: number

  /** Called when the selected node changes, with the node or `undefined`. */
  readonly onNodeSelected?: (node: ITreeNode<T> | undefined) => void

  readonly id?: string
  readonly ariaLabel?: string
}

interface ITreeState {
  /** Which parent nodes are expanded. Local UI state — the tree owns nothing else. */
  readonly expanded: ReadonlySet<string>

  /** The selected node's id, if any. */
  readonly selectedId: string | undefined
}

const DefaultRowHeight = 32

/**
 * A tree, built as an adapter over `List` rather than a second virtualizer.
 *
 * `List` already owns virtualization, `aria-activedescendant`, roving
 * tabindex, and arrow/Home/End navigation, tested for years. This flattens the
 * visible nodes into its rows and lends them tree semantics; the only change to
 * `List` is a widened `role` and a per-row metadata hook. Generic on purpose:
 * it never learns whether its nodes are worktrees or context items.
 */
export class Tree<T> extends React.Component<ITreeProps<T>, ITreeState> {
  public constructor(props: ITreeProps<T>) {
    super(props)
    this.state = { expanded: new Set<string>(), selectedId: undefined }
  }

  private get rows(): ReadonlyArray<IFlatTreeRow<T>> {
    return flattenTree(this.props.roots, this.isExpanded)
  }

  private isExpanded = (id: string): boolean => this.state.expanded.has(id)

  private toggle = (id: string): void => {
    this.setState(prev => {
      const expanded = new Set(prev.expanded)
      if (expanded.has(id)) {
        expanded.delete(id)
      } else {
        expanded.add(id)
      }

      // Collapsing must not strand the selection on a row that just vanished.
      const isExpanded = (nodeId: string) => expanded.has(nodeId)
      const selectedId =
        prev.selectedId === undefined
          ? undefined
          : nearestVisibleId(this.props.roots, isExpanded, prev.selectedId)

      return { expanded, selectedId }
    })
  }

  private onSelectedRowChanged = (row: number): void => {
    const node = this.rows[row]?.node
    this.setState({ selectedId: node?.id })
    this.props.onNodeSelected?.(node)
  }

  private onRowKeyDown = (
    row: number,
    event: React.KeyboardEvent<any>
  ): void => {
    const flat = this.rows[row]
    if (flat === undefined) {
      return
    }

    // The expand/collapse half of the keyboard. The full map is #20; this is
    // only what a tree cannot do without: open a node, close a node, and step
    // out to the parent when there is nothing to close.
    if (event.key === 'ArrowRight') {
      if (flat.hasChildren && !flat.expanded) {
        event.preventDefault()
        this.toggle(flat.node.id)
      }
      return
    }

    if (event.key === 'ArrowLeft') {
      if (flat.expanded) {
        event.preventDefault()
        this.toggle(flat.node.id)
      } else if (flat.level > 1) {
        // Step to the visible parent, which is the nearest visible ancestor
        // once this node is treated as hidden.
        event.preventDefault()
        const parentId = nearestVisibleId(
          this.props.roots,
          id => this.state.expanded.has(id) && id !== flat.node.id,
          flat.node.id
        )
        if (parentId !== undefined) {
          const parentRow = this.rows.findIndex(r => r.node.id === parentId)
          if (parentRow >= 0) {
            this.setState({ selectedId: parentId })
            this.props.onNodeSelected?.(this.rows[parentRow].node)
          }
        }
      }
    }
  }

  private renderRow = (row: number): JSX.Element | null => {
    const flat = this.rows[row]
    if (flat === undefined) {
      return null
    }
    return (
      <TreeRow
        row={flat}
        onToggle={this.toggle}
        renderNode={this.props.renderNode}
      />
    )
  }

  private getRowTreeMetadata = (row: number): ITreeRowMetadata | undefined => {
    const flat = this.rows[row]
    if (flat === undefined) {
      return undefined
    }
    return {
      level: flat.level,
      posInSet: flat.posInSet,
      setSize: flat.setSize,
      expanded: flat.hasChildren ? flat.expanded : undefined,
    }
  }

  public render() {
    const rows = this.rows
    const selectedRow =
      this.state.selectedId === undefined
        ? -1
        : rows.findIndex(r => r.node.id === this.state.selectedId)

    return (
      <List
        id={this.props.id}
        ariaLabel={this.props.ariaLabel}
        role="tree"
        rowCount={rows.length}
        rowHeight={this.props.rowHeight ?? DefaultRowHeight}
        selectedRows={selectedRow >= 0 ? [selectedRow] : []}
        onSelectedRowChanged={this.onSelectedRowChanged}
        onRowKeyDown={this.onRowKeyDown}
        rowRenderer={this.renderRow}
        getRowTreeMetadata={this.getRowTreeMetadata}
      />
    )
  }
}
