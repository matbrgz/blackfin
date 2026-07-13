import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ITreeNode,
  flattenTree,
  nearestVisibleId,
  parentIdOf,
} from '../../src/ui/lib/tree/flatten'

function node(
  id: string,
  children: Array<ITreeNode<string>> = []
): ITreeNode<string> {
  return { id, data: id, children }
}

// a ─┬ a1 ─ a1x
//    └ a2
// b
const forest: ReadonlyArray<ITreeNode<string>> = [
  node('a', [node('a1', [node('a1x')]), node('a2')]),
  node('b'),
]

function expandedSet(...ids: Array<string>) {
  const set = new Set(ids)
  return (id: string) => set.has(id)
}

describe('flattenTree', () => {
  it('shows only the roots when everything is collapsed', () => {
    const rows = flattenTree(forest, expandedSet())
    assert.deepStrictEqual(
      rows.map(r => r.node.id),
      ['a', 'b']
    )
    assert.deepStrictEqual(
      rows.map(r => r.level),
      [1, 1]
    )
  })

  it('inserts a node’s children right after it — and not its grandchildren', () => {
    const rows = flattenTree(forest, expandedSet('a'))
    // a1 has a child, but a1 is collapsed, so a1x must NOT appear.
    assert.deepStrictEqual(
      rows.map(r => r.node.id),
      ['a', 'a1', 'a2', 'b']
    )
  })

  it('sets aria-level to 1 at the root and increments by depth', () => {
    const rows = flattenTree(forest, expandedSet('a', 'a1'))
    const level = (id: string) => rows.find(r => r.node.id === id)?.level
    assert.strictEqual(level('a'), 1)
    assert.strictEqual(level('a1'), 2)
    assert.strictEqual(level('a1x'), 3)
  })

  it('counts posInSet/setSize among level siblings, not flattened index', () => {
    const rows = flattenTree(forest, expandedSet('a'))
    const row = (id: string) => rows.find(r => r.node.id === id)!

    // a1 and a2 are the two children of a.
    assert.strictEqual(row('a1').posInSet, 1)
    assert.strictEqual(row('a1').setSize, 2)
    assert.strictEqual(row('a2').posInSet, 2)
    assert.strictEqual(row('a2').setSize, 2)

    // b is the 2nd of 2 roots — NOT the 4th of 4 flattened rows.
    assert.strictEqual(row('b').posInSet, 2)
    assert.strictEqual(row('b').setSize, 2)
  })

  it('marks expandability and expansion correctly', () => {
    const rows = flattenTree(forest, expandedSet('a'))
    const row = (id: string) => rows.find(r => r.node.id === id)!
    assert.strictEqual(row('a').hasChildren, true)
    assert.strictEqual(row('a').expanded, true)
    assert.strictEqual(row('a1').hasChildren, true)
    assert.strictEqual(row('a1').expanded, false)
    assert.strictEqual(row('a2').hasChildren, false)
    assert.strictEqual(row('a2').expanded, false)
  })

  it('flattens an empty forest to zero rows without throwing', () => {
    assert.deepStrictEqual(flattenTree([], expandedSet()), [])
  })
})

describe('nearestVisibleId', () => {
  it('keeps the selection when it is still visible', () => {
    assert.strictEqual(
      nearestVisibleId(forest, expandedSet('a', 'a1'), 'a1x'),
      'a1x'
    )
  })

  // Collapsing an ancestor of the selected node must move the selection up to
  // the ancestor that is still on screen, not drop it on the floor.
  it('moves the selection to the collapsed ancestor', () => {
    // a1x was selected; now a is collapsed, so a1x and a1 are hidden.
    assert.strictEqual(nearestVisibleId(forest, expandedSet('a1'), 'a1x'), 'a')
  })

  it('returns undefined for an id not in the forest', () => {
    assert.strictEqual(
      nearestVisibleId(forest, expandedSet('a'), 'nope'),
      undefined
    )
  })
})

describe('parentIdOf', () => {
  // ArrowLeft on a leaf steps out to the parent; this is the lookup behind it.
  // It must return the actual parent, not the node itself.
  it('returns the parent of a nested node', () => {
    assert.strictEqual(parentIdOf(forest, 'a1x'), 'a1')
    assert.strictEqual(parentIdOf(forest, 'a1'), 'a')
    assert.strictEqual(parentIdOf(forest, 'a2'), 'a')
  })

  it('returns undefined for a root', () => {
    assert.strictEqual(parentIdOf(forest, 'a'), undefined)
    assert.strictEqual(parentIdOf(forest, 'b'), undefined)
  })

  it('returns undefined for an unknown id', () => {
    assert.strictEqual(parentIdOf(forest, 'nope'), undefined)
  })
})
