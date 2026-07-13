import { TaskProviderId, TaskState } from '../../models/task'

// Map a tracker's own state word onto Blackfin's four canonical states — and be
// explicit about not knowing. A Linear board with seven workflow states does
// not collapse into four without loss, and the loss has to be *representable*,
// not swallowed: #79 depends on this returning `Unknown` so it can refuse an
// ambiguous write instead of guessing.

/** Normalize a raw state for lookup: trim, lowercase, collapse inner whitespace. */
function normalize(rawState: string): string {
  return rawState.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Shared synonyms most trackers agree on. Matching is *exact* on the normalized
// string — never a partial match, so "Not In Review" does not become InReview.
const CommonStates: ReadonlyMap<string, TaskState> = new Map([
  ['todo', TaskState.Todo],
  ['to do', TaskState.Todo],
  ['backlog', TaskState.Todo],
  ['open', TaskState.Todo],
  ['in progress', TaskState.InProgress],
  ['doing', TaskState.InProgress],
  ['started', TaskState.InProgress],
  ['in review', TaskState.InReview],
  ['in progress review', TaskState.InReview],
  ['done', TaskState.Done],
  ['closed', TaskState.Done],
  ['completed', TaskState.Done],
  ['merged', TaskState.Done],
])

// GitHub Issues only ever reports `open` or `closed` — nothing else is a valid
// issue state, so its map is exactly those two and everything else is Unknown.
const GitHubIssueStates: ReadonlyMap<string, TaskState> = new Map([
  ['open', TaskState.Todo],
  ['closed', TaskState.Done],
])

const StatesByProvider: Record<
  TaskProviderId,
  ReadonlyMap<string, TaskState>
> = {
  [TaskProviderId.GitHubIssues]: GitHubIssueStates,
  [TaskProviderId.GitHubProjects]: CommonStates,
  [TaskProviderId.Linear]: CommonStates,
  [TaskProviderId.Jira]: CommonStates,
}

/**
 * Blackfin's canonical state for a provider's raw state string, or
 * `TaskState.Unknown` when it does not map without ambiguity. Never a guess:
 * `Blocked`, `Won't Fix`, a cancelled state and an empty string are all Unknown,
 * because forcing them into one of four would be Blackfin inventing a fact.
 */
export function mapToTaskState(
  providerId: TaskProviderId,
  rawState: string
): TaskState {
  return (
    StatesByProvider[providerId].get(normalize(rawState)) ?? TaskState.Unknown
  )
}
