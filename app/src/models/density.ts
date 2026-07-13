/**
 * How much room a row of the control center gets.
 *
 * A git client shows one diff: one thing, large. A control center shows forty
 * projects, each with N context files and M MCP servers, and the user is
 * scanning for the one that is wrong. Those are different jobs, and the row
 * height that serves the first is the wrong height for the second.
 *
 * `Comfortable` is the default, because a person meeting the product for the
 * first time is reading, not scanning. `Compact` is for the person who lives in
 * it.
 */
export enum Density {
  Comfortable = 'comfortable',
  Compact = 'compact',
}

export const DefaultDensity = Density.Comfortable

/** The class the body carries, consumed by `app/styles/_tokens.scss`. */
export function densityClassName(density: Density): string {
  return `density-${density}`
}
