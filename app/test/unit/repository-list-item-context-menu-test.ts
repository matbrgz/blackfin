import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Repository } from '../../src/models/repository'
import { generateRepositoryListContextMenu } from '../../src/ui/repositories-list/repository-list-item-context-menu'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('repository list item context menu', () => {
  const buildConfig = (
    overrides: Partial<
      Parameters<typeof generateRepositoryListContextMenu>[0]
    > = {}
  ) => {
    const repository =
      overrides.repository ??
      new Repository(
        '/tmp/repo',
        1,
        gitHubRepoFixture({ owner: 'example', name: 'repo' }),
        false,
        'alias',
        'group'
      )

    return {
      repository,
      shellLabel: undefined,
      externalEditorLabel: undefined,
      askForConfirmationOnRemoveRepository: true,
      showWorktreesInSidebar: false,
      onViewOnGitHub: () => {},
      onOpenInNewWindow: () => {},
      onOpenInShell: () => {},
      onShowRepository: () => {},
      onOpenInExternalEditor: () => {},
      onRemoveRepository: () => {},
      onAddNewWorktree: () => {},
      onRenameWorktree: () => {},
      onChangeRepositoryAlias: () => {},
      onRemoveRepositoryAlias: () => {},
      onChangeRepositoryGroupName: () => {},
      onRemoveRepositoryGroupName: () => {},
      onCopyRepoPath: () => {},
      ...overrides,
    }
  }

  it('shows alias and group name actions for normal repository rows', () => {
    const items = generateRepositoryListContextMenu(buildConfig())
    const labels = items.flatMap(item => ('label' in item ? [item.label] : []))

    assert(labels.includes('Change alias') || labels.includes('Change Alias'))
    assert(labels.includes('Remove alias') || labels.includes('Remove Alias'))
    assert(
      labels.includes('Change group name') ||
        labels.includes('Change Group Name')
    )
    assert(
      labels.includes('Restore group name') ||
        labels.includes('Restore Group Name')
    )
    assert(labels.includes('Remove…'))
  })

  it('hides alias and group name actions for linked worktree rows and deletes the worktree', () => {
    let removedRepository = false
    let removedLinkedWorktree = false

    const items = generateRepositoryListContextMenu(
      buildConfig({
        isLinkedWorktreeRow: true,
        isVirtualLinkedWorktreeRow: true,
        onRemoveRepository: () => {
          removedRepository = true
        },
        onRemoveLinkedWorktree: () => {
          removedLinkedWorktree = true
        },
      })
    )
    const labels = items.flatMap(item => ('label' in item ? [item.label] : []))

    assert(!labels.includes('Change alias'))
    assert(!labels.includes('Change Alias'))
    assert(!labels.includes('Remove alias'))
    assert(!labels.includes('Remove Alias'))
    assert(!labels.includes('Change group name'))
    assert(!labels.includes('Change Group Name'))
    assert(!labels.includes('Restore group name'))
    assert(!labels.includes('Restore Group Name'))
    assert(labels.includes('Delete…'))

    const deleteItem = items.find(
      (item): item is { label: string; action: () => void } =>
        'label' in item && item.label === 'Delete…'
    )
    assert(deleteItem !== undefined)

    deleteItem.action()

    assert.equal(removedLinkedWorktree, true)
    assert.equal(removedRepository, false)
  })

  it('keeps alias and group name actions for saved linked worktree rows', () => {
    const items = generateRepositoryListContextMenu(
      buildConfig({
        isLinkedWorktreeRow: true,
        isVirtualLinkedWorktreeRow: false,
        onRemoveLinkedWorktree: () => {},
      })
    )
    const labels = items.flatMap(item => ('label' in item ? [item.label] : []))

    assert(
      labels.includes('Rename Worktree') || labels.includes('Rename worktree')
    )
    assert(!labels.includes('Change group name'))
    assert(!labels.includes('Change Group Name'))
    assert(!labels.includes('Restore group name'))
    assert(!labels.includes('Restore Group Name'))
    assert(labels.includes('Delete…'))
    assert(!labels.includes('Remove…'))
  })

  it('shows a prune action for stale worktree rows and keeps remove semantics', () => {
    let prunedStaleWorktrees = false
    let removedRepository = false

    const items = generateRepositoryListContextMenu(
      buildConfig({
        isPrunableWorktreeRow: true,
        onPruneStaleWorktrees: () => {
          prunedStaleWorktrees = true
        },
        onRemoveRepository: () => {
          removedRepository = true
        },
      })
    )
    const labels = items.flatMap(item => ('label' in item ? [item.label] : []))

    assert(
      labels.includes('Prune stale worktrees') ||
        labels.includes('Prune Stale Worktrees')
    )
    assert(labels.includes('Remove…'))
    assert(!labels.includes('Delete…'))

    const pruneItem = items.find(
      (item): item is { label: string; action: () => void } =>
        'label' in item &&
        (item.label === 'Prune stale worktrees' ||
          item.label === 'Prune Stale Worktrees')
    )
    assert(pruneItem !== undefined)

    pruneItem.action()

    assert.equal(prunedStaleWorktrees, true)
    assert.equal(removedRepository, false)
  })

  it('shows only prune for stale virtual worktree rows', () => {
    const items = generateRepositoryListContextMenu(
      buildConfig({
        isLinkedWorktreeRow: true,
        isVirtualLinkedWorktreeRow: true,
        isPrunableWorktreeRow: true,
        onPruneStaleWorktrees: () => {},
      })
    )
    const labels = items.flatMap(item => ('label' in item ? [item.label] : []))

    assert.equal('type' in items[0] && items[0].type === 'separator', false)
    assert(
      labels.includes('Prune stale worktrees') ||
        labels.includes('Prune Stale Worktrees')
    )
    assert(!labels.includes('Delete…'))
    assert(!labels.includes('Remove…'))
  })
})
