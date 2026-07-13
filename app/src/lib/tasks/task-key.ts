import { TaskKey, TaskProviderId } from '../../models/task'

/**
 * The stable key for a task, across any provider.
 *
 * Composite on purpose: GitHub's `number` is unique only within a repository,
 * Linear's id is a string (`ENG-431`), Jira's is a project key (`PROJ-12`). Only
 * `${providerId}:${externalId}` survives all four — and a `123` from GitHub and
 * a `123` from Linear must never collide.
 */
export function taskKey(
  providerId: TaskProviderId,
  externalId: string
): TaskKey {
  return `${providerId}:${externalId}`
}
