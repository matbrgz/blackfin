/**
 * The heart of `Tree`, kept pure and apart from React so it can be tested
 * without a DOM. A tree is only ever shown as a flat list of its *visible*
 * rows; this is the function that does the flattening, and the ARIA a screen
 * reader needs to understand the shape is computed here, once, correctly.
 */

/** A node in a tree. Generic on purpose: the library never learns what `T` is. */
export interface ITreeNode<T> {
  readonly id: string
  readonly data: T
  readonly children: ReadonlyArray<ITreeNode<T>>
}

/** One visible row, with the ARIA metadata for its position in the tree. */
export interface IFlatTreeRow<T> {
  readonly node: ITreeNode<T>

  /** `aria-level`, 1-based: 1 at the roots, +1 per generation. */
  readonly level: number

  /**
   * `aria-posinset`, 1-based — position among *siblings at this level*, NOT the
   * row's index in the flattened list. Conflating the two is the classic tree
   * bug that makes a screen reader announce "item 14 of 40" for the second
   * child of the third project. This is computed from the sibling array.
   */
  readonly posInSet: number

  /** `aria-setsize` — the count of siblings at this level. */
  readonly setSize: number

  readonly hasChildren: boolean

  /** `aria-expanded`. Meaningful only where `hasChildren`; false otherwise. */
  readonly expanded: boolean
}

/**
 * Flatten a forest to the rows that are currently visible.
 *
 * A node's children appear immediately after it, and only when it is expanded —
 * so expanding a node reveals its children but not its grandchildren, exactly
 * as a tree should behave.
 */
export function flattenTree<T>(
  roots: ReadonlyArray<ITreeNode<T>>,
  isExpanded: (id: string) => boolean
): ReadonlyArray<IFlatTreeRow<T>> {
  const rows: Array<IFlatTreeRow<T>> = []

  const walk = (nodes: ReadonlyArray<ITreeNode<T>>, level: number): void => {
    nodes.forEach((node, index) => {
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && isExpanded(node.id)

      rows.push({
        node,
        level,
        posInSet: index + 1,
        setSize: nodes.length,
        hasChildren,
        expanded,
      })

      if (expanded) {
        walk(node.children, level + 1)
      }
    })
  }

  walk(roots, 1)
  return rows
}

/**
 * The path from a root down to `id`, inclusive, or `undefined` if the id is not
 * in the forest.
 */
function findPath<T>(
  roots: ReadonlyArray<ITreeNode<T>>,
  id: string
): ReadonlyArray<ITreeNode<T>> | undefined {
  for (const node of roots) {
    if (node.id === id) {
      return [node]
    }
    const below = findPath(node.children, id)
    if (below !== undefined) {
      return [node, ...below]
    }
  }
  return undefined
}

/**
 * The id of `id`'s parent, or `undefined` for a root or an unknown id. Used to
 * step the selection out to the parent, which — for a currently visible node —
 * is itself always visible.
 */
export function parentIdOf<T>(
  roots: ReadonlyArray<ITreeNode<T>>,
  id: string
): string | undefined {
  const path = findPath(roots, id)
  if (path === undefined || path.length < 2) {
    return undefined
  }
  return path[path.length - 2].id
}

/**
 * The id that should hold the selection given the current expansion.
 *
 * When a node is collapsed while one of its descendants is selected, the
 * selection cannot stay on a row that is no longer shown — but it must not be
 * *lost* either, which strands the keyboard. It moves to the nearest ancestor
 * that is still visible, which is the node the user just collapsed. If the
 * selected id is still visible it is returned unchanged.
 */
export function nearestVisibleId<T>(
  roots: ReadonlyArray<ITreeNode<T>>,
  isExpanded: (id: string) => boolean,
  id: string
): string | undefined {
  const path = findPath(roots, id)
  if (path === undefined) {
    return undefined
  }

  let visible: string | undefined = undefined
  for (let depth = 0; depth < path.length; depth++) {
    // The node at `depth` is visible iff every ancestor above it is expanded.
    const ancestorsExpanded = path
      .slice(0, depth)
      .every(ancestor => isExpanded(ancestor.id))

    if (!ancestorsExpanded) {
      break
    }
    visible = path[depth].id
  }

  return visible
}
