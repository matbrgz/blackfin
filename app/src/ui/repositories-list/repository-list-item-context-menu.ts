import {
  isRepositoryWithGitHubRepository,
  hasDefaultRemoteUrl,
  Repository,
} from '../../models/repository'
import { RepoType } from '../../models/github-repository'
import { IMenuItem } from '../../lib/menu-item'
import { Repositoryish } from './group-repositories'
import { clipboard } from 'electron'
import {
  RevealInFileManagerLabel,
  DefaultEditorLabel,
  DefaultShellLabel,
} from '../lib/context-menu'

interface IRepositoryListItemContextMenuConfig {
  repository: Repositoryish
  shellLabel: string | undefined
  externalEditorLabel: string | undefined
  askForConfirmationOnRemoveRepository: boolean
  showWorktreesInSidebar: boolean
  readonly isLinkedWorktreeRow?: boolean
  readonly isVirtualLinkedWorktreeRow?: boolean
  readonly isPrunableWorktreeRow?: boolean
  onViewInBrowser: (repository: Repositoryish) => void
  onOpenInNewWindow?: (repository: Repositoryish) => void
  onOpenInShell: (repository: Repositoryish) => void
  onShowRepository: (repository: Repositoryish) => void
  onOpenInExternalEditor: (repository: Repositoryish) => void
  onRemoveRepository: (repository: Repositoryish) => void
  onRemoveLinkedWorktree?: () => void
  onPruneStaleWorktrees?: () => void
  onAddNewWorktree: (repository: Repository) => void
  onRenameWorktree?: (repository: Repository) => void
  onChangeRepositoryAlias: (repository: Repository) => void
  onRemoveRepositoryAlias: (repository: Repository) => void
  onChangeRepositoryGroupName: (repository: Repository) => void
  onRemoveRepositoryGroupName: (repository: Repository) => void
  onCopyRepoPath: (path: string) => void
  isPinned?: boolean
  onPinRepository?: (repository: Repository) => void
  onUnpinRepository?: (repository: Repository) => void
}

export const generateRepositoryListContextMenu = (
  config: IRepositoryListItemContextMenuConfig
) => {
  const { repository } = config
  const isLinkedWorktreeRow = config.isLinkedWorktreeRow ?? false
  const isPrunableWorktreeRow = config.isPrunableWorktreeRow ?? false
  const identityMenuItems = [
    ...buildNewWorkreeMenuItems(config),
    ...buildAliasMenuItems(config),
    ...buildGroupNameMenuItems(config),
    ...buildPinMenuItems(config),
  ]
  const missing = repository instanceof Repository && repository.missing
  const isGitHub =
    repository instanceof Repository &&
    isRepositoryWithGitHubRepository(repository)
  const hasOriginUrl =
    repository instanceof Repository && hasDefaultRemoteUrl(repository)
  const canOpenInNewWindow =
    repository instanceof Repository && !repository.missing
  const openInExternalEditor = config.externalEditorLabel
    ? `Open in ${config.externalEditorLabel}`
    : DefaultEditorLabel
  const openInShell = config.shellLabel
    ? `Open in ${config.shellLabel}`
    : DefaultShellLabel

  const items: ReadonlyArray<IMenuItem> = [
    ...identityMenuItems,
    ...(identityMenuItems.length > 0 ? [{ type: 'separator' as const }] : []),
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => clipboard.writeText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => config.onCopyRepoPath(repository.path),
    },
    { type: 'separator' },
    {
      label: getViewOnBrowserLabel(
        isGitHub ? repository.gitHubRepository.type : null
      ),
      action: () => config.onViewInBrowser(repository),
      enabled: isGitHub || hasOriginUrl,
    },
    ...(config.onOpenInNewWindow && canOpenInNewWindow
      ? [
          {
            label: __DARWIN__
              ? 'Open Repository in New Window'
              : 'Open repository in new window',
            action: () => config.onOpenInNewWindow?.(repository),
          },
        ]
      : []),
    {
      label: openInShell,
      action: () => config.onOpenInShell(repository),
      enabled: !missing,
    },
    {
      label: RevealInFileManagerLabel,
      action: () => config.onShowRepository(repository),
      enabled: !missing,
    },
    {
      label: openInExternalEditor,
      action: () => config.onOpenInExternalEditor(repository),
      enabled: !missing,
    },
    ...(isPrunableWorktreeRow && config.onPruneStaleWorktrees !== undefined
      ? [
          { type: 'separator' as const },
          {
            label: __DARWIN__
              ? 'Prune Stale Worktrees'
              : 'Prune stale worktrees',
            action: config.onPruneStaleWorktrees,
          },
        ]
      : []),
    ...(!(isPrunableWorktreeRow && isLinkedWorktreeRow)
      ? [
          { type: 'separator' as const },
          {
            label: isPrunableWorktreeRow
              ? config.askForConfirmationOnRemoveRepository
                ? 'Remove…'
                : 'Remove'
              : isLinkedWorktreeRow
              ? 'Delete…'
              : config.askForConfirmationOnRemoveRepository
              ? 'Remove…'
              : 'Remove',
            action:
              !isPrunableWorktreeRow &&
              isLinkedWorktreeRow &&
              config.onRemoveLinkedWorktree !== undefined
                ? config.onRemoveLinkedWorktree
                : () => config.onRemoveRepository(repository),
          },
        ]
      : []),
  ]

  return items
}

function getViewOnBrowserLabel(repoType: RepoType | null) {
  switch (repoType) {
    case 'github':
      return 'View on GitHub'
    case 'bitbucket':
      return 'View on Bitbucket'
    case 'gitlab':
      return 'View on GitLab'
    default:
      return 'View in your browser'
  }
}

const buildNewWorkreeMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!config.showWorktreesInSidebar || !(repository instanceof Repository)) {
    return []
  }

  return [
    {
      label: __DARWIN__ ? 'Add New Worktree' : 'Add new worktree',
      action: () => config.onAddNewWorktree(repository),
    },
  ]
}

const buildAliasMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  if (config.isLinkedWorktreeRow || config.isVirtualLinkedWorktreeRow) {
    return [
      {
        label: __DARWIN__ ? `Rename Worktree` : `Rename worktree`,
        action: () => config.onRenameWorktree?.(repository),
      },
    ]
  }

  const verb = repository.alias == null ? 'Create' : 'Change'
  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `${verb} Alias` : `${verb} alias`,
      action: () => config.onChangeRepositoryAlias(repository),
    },
  ]

  if (repository.alias !== null) {
    items.push({
      label: __DARWIN__ ? 'Remove Alias' : 'Remove alias',
      action: () => config.onRemoveRepositoryAlias(repository),
    })
  }

  return items
}

const buildGroupNameMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (
    !(repository instanceof Repository) ||
    config.isLinkedWorktreeRow ||
    config.isVirtualLinkedWorktreeRow
  ) {
    return []
  }

  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `Change Group Name` : `Change group name`,
      action: () => config.onChangeRepositoryGroupName(repository),
    },
  ]

  if (repository.groupName !== null) {
    items.push({
      label: __DARWIN__ ? 'Restore Group Name' : 'Restore group name',
      action: () => config.onRemoveRepositoryGroupName(repository),
    })
  }

  return items
}

const buildPinMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (
    !(repository instanceof Repository) ||
    config.isLinkedWorktreeRow ||
    config.isVirtualLinkedWorktreeRow
  ) {
    return []
  }

  if (config.isPinned && config.onUnpinRepository) {
    return [
      {
        label: __DARWIN__ ? 'Unpin Repository' : 'Unpin repository',
        action: () => config.onUnpinRepository!(repository),
      },
    ]
  }

  if (!config.isPinned && config.onPinRepository) {
    return [
      {
        label: __DARWIN__ ? 'Pin Repository' : 'Pin repository',
        action: () => config.onPinRepository!(repository),
      },
    ]
  }

  return []
}
