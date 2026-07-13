import { AppSection } from '../../models/app-section'
import {
  ContextRole,
  ContextScope,
  InventoryStatus,
  IRepositoryInventory,
} from '../../models/workspace-inventory'

/** Human-readable names for the workspace UI. Pure, so they live apart. */

export function explainStatus(status: InventoryStatus): string {
  switch (status.kind) {
    case 'ok':
      return ''
    case 'never-scanned':
      return 'This project has not been scanned yet, so we do not know what is in it.'
    case 'missing':
      return 'This project is no longer on disk.'
    case 'error':
      return status.message
  }
}

/**
 * Whether this inventory may be counted in a statistic.
 *
 * A never-scanned project must not be. "12 projects have no agent context" is a
 * claim, and a claim that silently includes projects nobody looked at is false.
 * Blackfin does not present absence of data as absence of the thing.
 */
export function isCountable(inventory: IRepositoryInventory): boolean {
  return inventory.status.kind === 'ok'
}

/**
 * Whether this project may be put in front of the user as needing attention.
 *
 * Only a scanned project can. We do not know whether an unscanned one needs
 * anything — that is what "unscanned" means — and telling somebody to go look at
 * a project we never read wastes the one thing this screen is spending: their
 * attention.
 */
export function needsAttention(inventory: IRepositoryInventory): boolean {
  return isCountable(inventory)
}

export function sectionTitle(section: AppSection): string {
  switch (section) {
    case AppSection.Agents:
      return 'Agents'
    case AppSection.Docs:
      return 'Docs'
    case AppSection.Disk:
      return 'Disk'
    default:
      return ''
  }
}

export function sectionSubtitle(section: AppSection): string {
  switch (section) {
    case AppSection.Agents:
      return 'What steers the agents writing your code — on this machine, and in each project.'
    case AppSection.Docs:
      return 'Documentation across every project.'
    case AppSection.Disk:
      return 'What your projects are sitting on, and what you can take back.'
    default:
      return ''
  }
}

export function roleDisplayName(role: ContextRole): string {
  switch (role) {
    case ContextRole.Instructions:
      return 'Instructions'
    case ContextRole.Skill:
      return 'Skill'
    case ContextRole.Command:
      return 'Command'
    case ContextRole.Subagent:
      return 'Subagent'
    case ContextRole.Prompt:
      return 'Prompt'
    case ContextRole.Settings:
      return 'Settings'
    case ContextRole.Hook:
      return 'Hook'
  }
}

export function scopeDisplayName(scope: ContextScope): string {
  switch (scope) {
    case ContextScope.Global:
      return 'Global'
    case ContextScope.Project:
      return 'Project'
  }
}

/**
 * Pluralize `word` for `count`.
 *
 * Pass `plural` explicitly when appending an `s` would be wrong — "directorys",
 * "wass". English has enough of these that guessing is not an option.
 */
export function plural(count: number, word: string, plural?: string): string {
  if (count === 1) {
    return word
  }

  return plural ?? `${word}s`
}
