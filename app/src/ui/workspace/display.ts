import { AppSection } from '../../models/app-section'
import { ContextRole, ContextScope } from '../../models/workspace-inventory'

/** Human-readable names for the workspace UI. Pure, so they live apart. */

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

export function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
