/**
 * The top-level destinations of the app.
 *
 * This is the load-bearing statement of what Blackfin is. `Code` — the entire
 * git client, sidebar and diff and history and all — is *one* of these, not the
 * frame the others hang off. A control center whose chrome is a git client's
 * chrome is a git client with extra screens.
 */
export enum AppSection {
  /** The command center: what needs your attention, across every project. */
  Home = 'home',
  /** The git client. Everything the app was before. */
  Code = 'code',
  /** The context steering every agent, across every project. */
  Agents = 'agents',
  /** Documentation, across every project. */
  Docs = 'docs',
  /** Reclaimable disk, across every project. */
  Disk = 'disk',
}

/** Sections that render the cross-project workspace, and the lens each uses. */
export function isWorkspaceSection(section: AppSection): boolean {
  return (
    section === AppSection.Agents ||
    section === AppSection.Docs ||
    section === AppSection.Disk
  )
}
