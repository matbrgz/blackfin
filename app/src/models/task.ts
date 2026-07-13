// The internal task domain (#72), independent of any provider.
//
// A task starts in a tracker — a GitHub issue, a Linear ticket, a Jira card —
// each with its own identifier, its own states, its own idea of a repository.
// If the first provider is written before this domain exists, GitHub's shape
// *becomes* the domain, and Linear (`ENG-431`, a team-named workflow state, no
// repository) has to be forced into it, lying in every field. This file is the
// shape all providers normalize *to*, so none of them gets to be the shape.
//
// Pure types only — no I/O, no store, no persistence. The Dexie tables are #73
// and #74; here there are only the types they will hold.

export enum TaskProviderId {
  GitHubIssues = 'github-issues',
  GitHubProjects = 'github-projects',
  Linear = 'linear',
  Jira = 'jira',
}

/**
 * Blackfin's canonical task state. Deliberately poor: it is the app's
 * vocabulary, not the tracker's. The tracker's own word lives in `rawState` and
 * is always shown alongside, so the team never loses the label it chose and
 * Blackfin never pretends its four states are the truth.
 */
export enum TaskState {
  Todo = 'todo',
  InProgress = 'in-progress',
  InReview = 'in-review',
  Done = 'done',
  /** The tracker returned a state that does not map without ambiguity. */
  Unknown = 'unknown',
}

export interface ITaskAssignee {
  readonly externalId: string
  readonly displayName: string
  readonly avatarURL: string | null
}

export interface ITaskLabel {
  readonly name: string
  /** Hex without the leading `#`, as GitHub returns it. Null when the provider gives no colour. */
  readonly color: string | null
}

/**
 * A task, normalized across providers.
 *
 * There is deliberately no field for a token, credential, header or endpoint —
 * a provider must not be able to smuggle the key that fetched the task into the
 * task object, and from there into the Dexie cache. Provider credentials live
 * in the OS keychain (`token-store.ts`), never here. There is also no `body`:
 * an issue body is untrusted third-party content and may carry a secret someone
 * else pasted; fetching and rendering it (sandboxed) is #73's decision, not a
 * field every cache carries by default.
 */
export interface ITask {
  readonly providerId: TaskProviderId
  /** The provider's id: GitHub's number, Linear's `ENG-431`, Jira's `PROJ-12`. */
  readonly externalId: string
  /** The identifier a human recognizes: `#123`, `ENG-431`. */
  readonly displayId: string
  readonly title: string
  /** Blackfin's canonical state. */
  readonly state: TaskState
  /** The tracker's literal string. Never translated, always displayed. */
  readonly rawState: string
  readonly assignees: ReadonlyArray<ITaskAssignee>
  readonly labels: ReadonlyArray<ITaskLabel>
  readonly url: string
  readonly updatedAt: string
  readonly createdAt: string
  /**
   * The repository this task belongs to, when the provider has that concept —
   * GitHub Issues does; Linear and Jira do NOT, so for them this is null and the
   * association is a user-configured mapping (#75).
   */
  readonly gitHubRepositoryID: number | null
}

/** A task's stable key across any provider: `${providerId}:${externalId}`. */
export type TaskKey = string

/** The link between a task and a branch (and, later, a worktree). Persisted by #74. */
export interface ITaskLink {
  readonly taskKey: TaskKey
  readonly repositoryId: number
  readonly branchName: string
  readonly worktreePath: string | null
  readonly createdAt: number
}
