import {
  Repository,
  ILocalRepositoryState,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { getHTMLURL } from '../../lib/api'
import { compare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { assertNever } from '../../lib/fatal-error'
import { isGHE, isGHES } from '../../lib/endpoint-capabilities'
import { Owner } from '../../models/owner'
import { normalizePath } from '../../lib/helpers/path'
import {
  getRepositoryListTitle,
  toSortedRepositoryListItems,
} from './worktree-list-items'

export type RepositoryListGroup = (
  | {
      kind: 'recent' | 'other' | 'pins'
    }
  | {
      kind: 'dotcom'
      owner: Owner
      login: string | null
    }
  | {
      kind: 'enterprise'
      host: string
    }
) & { displayName: string | null }

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  const { kind, displayName } = group
  switch (kind) {
    case 'pins':
      return `-1:pins`
    case 'recent':
      return `0:recent`
    case 'dotcom':
      return displayName
        ? `1:${displayName}`
        : `1:${group.owner.login}:${group.login ?? group.owner.login}`
    case 'enterprise':
      // Allow mixing together dotcom and enterprise repos when setting a group name manually
      return displayName ? `1:${displayName}` : `2:${group.host}`
    case 'other':
      return displayName ? `1:${displayName}` : `3:other`
    default:
      assertNever(group, `Unknown repository group kind ${kind}`)
  }
}
export type Repositoryish = Repository | CloningRepository

export interface IRepositoryListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly title: string
  readonly repository: Repositoryish
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
  readonly branchName: string | null
  readonly defaultBranchName: string | null
  readonly isNestedWorktree: boolean
  readonly mainWorktreeName: string | null
  readonly isVirtualLinkedWorktree: boolean
  readonly isPrunableWorktree: boolean
  readonly worktreePath: string | null
  readonly sourceRepository: Repository | null
}

interface IGroupRepositoriesOptions {
  readonly showWorktreesInSidebar?: boolean
}

const recentRepositoriesThreshold = 7

const getHostForRepository = (repo: RepositoryWithGitHubRepository) =>
  new URL(getHTMLURL(repo.gitHubRepository.endpoint)).host

const getGroupForRepository = (repo: Repositoryish): RepositoryListGroup => {
  if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
    return isGHE(repo.gitHubRepository.endpoint) ||
      isGHES(repo.gitHubRepository.endpoint)
      ? {
          kind: 'enterprise',
          host: getHostForRepository(repo),
          displayName: repo.groupName,
        }
      : {
          kind: 'dotcom',
          owner: repo.gitHubRepository.owner,
          displayName: repo.groupName,
          login: repo.gitHubRepository.login,
        }
  }
  if (repo instanceof Repository) {
    return { kind: 'other', displayName: repo.groupName }
  }
  return { kind: 'other', displayName: null }
}

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  recentRepositories: ReadonlyArray<number>,
  options: IGroupRepositoriesOptions = {}
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const includeRecentGroup = repositories.length > recentRepositoriesThreshold
  const recentSet = includeRecentGroup ? new Set(recentRepositories) : undefined
  const groups = new Map<string, RepoGroupItem>()
  const repositoryByPath = new Map<string, Repository>()
  const storedRepositoryPaths = new Set<string>()

  for (const repository of repositories) {
    if (!(repository instanceof Repository)) {
      continue
    }

    const normalizedPath = normalizePath(repository.path)
    repositoryByPath.set(normalizedPath, repository)
    storedRepositoryPaths.add(normalizedPath)
  }

  const addToGroup = (group: RepositoryListGroup, repo: Repositoryish) => {
    const key = getGroupKey(group)
    let rg = groups.get(key)
    if (!rg) {
      rg = { group, repos: [] }
      groups.set(key, rg)
    }

    rg.repos.push(repo)
  }

  for (const repo of repositories) {
    if (recentSet?.has(repo.id) && repo instanceof Repository) {
      addToGroup({ kind: 'recent', displayName: repo.groupName }, repo)
    }

    addToGroup(getGroupForRepository(repo), repo)
  }

  return Array.from(groups)
    .sort(([xKey], [yKey]) => compare(xKey.toLowerCase(), yKey.toLowerCase()))
    .map(([, { group, repos }]) => ({
      identifier: group,
      items: toSortedListItems(
        group,
        repos,
        localRepositoryStateLookup,
        groups,
        repositoryByPath,
        storedRepositoryPaths,
        options
      ),
    }))
}

const toSortedListItems = (
  group: RepositoryListGroup,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  groups: Map<string, RepoGroupItem>,
  repositoryByPath: ReadonlyMap<string, Repository>,
  storedRepositoryPaths: ReadonlySet<string>,
  options: IGroupRepositoriesOptions
): IRepositoryListItem[] => {
  const showWorktreesInSidebar = options.showWorktreesInSidebar ?? false
  const groupNames = new Map<string, number>()
  const allNames = new Map<string, number>()

  for (const groupItem of groups.values()) {
    // All items in the recent group are by definition present in another
    // group and therefore we don't want to count them.
    if (groupItem.group.kind === 'recent') {
      continue
    }

    for (const title of groupItem.repos.map(repo =>
      getRepositoryListTitle(repo, showWorktreesInSidebar)
    )) {
      allNames.set(title, (allNames.get(title) ?? 0) + 1)
      if (groupItem.group === group) {
        groupNames.set(title, (groupNames.get(title) ?? 0) + 1)
      }
    }
  }
  return toSortedRepositoryListItems({
    group,
    repositories,
    localRepositoryStateLookup,
    groupNames,
    allNames,
    repositoryByPath,
    storedRepositoryPaths,
    showWorktreesInSidebar,
  })
}

/**
 * Extracts pinned items from existing groups and returns a Pins group, or null
 * if none of the pinned IDs are found in the groups.
 */
export function buildPinnedGroup(
  pinnedIds: ReadonlyArray<number>,
  allGroups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >
): IFilterListGroup<IRepositoryListItem, RepositoryListGroup> | null {
  if (pinnedIds.length === 0) {
    return null
  }

  const idToItem = new Map<number, IRepositoryListItem>()
  for (const group of allGroups) {
    for (const item of group.items) {
      if (item.repository.id > 0 && !idToItem.has(item.repository.id)) {
        idToItem.set(item.repository.id, item)
      }
    }
  }

  const items = pinnedIds
    .map(id => idToItem.get(id))
    .filter((item): item is IRepositoryListItem => item !== undefined)

  if (items.length === 0) {
    return null
  }

  return { identifier: { kind: 'pins', displayName: null }, items }
}

/**
 * Returns groups with pinned items removed so they only appear in the Pins group.
 */
export function filterPinnedFromGroups(
  pinnedIds: ReadonlyArray<number>,
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  if (pinnedIds.length === 0) {
    return groups
  }

  const pinnedIdSet = new Set(pinnedIds)
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => !pinnedIdSet.has(item.repository.id)),
    }))
    .filter(group => group.items.length > 0)
}
