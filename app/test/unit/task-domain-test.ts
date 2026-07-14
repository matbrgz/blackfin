import { describe, it } from 'node:test'
import assert from 'node:assert'
import { ITask, TaskProviderId, TaskState } from '../../src/models/task'
import { taskKey } from '../../src/lib/tasks/task-key'
import { mapToTaskState } from '../../src/lib/tasks/task-state'
import { slugifyTaskForBranch } from '../../src/lib/tasks/task-branch-name'
import { sanitizedRefName } from '../../src/lib/sanitize-ref-name'

function sampleTask(overrides: Partial<ITask> = {}): ITask {
  return {
    providerId: TaskProviderId.GitHubIssues,
    externalId: '123',
    displayId: '#123',
    title: 'Fix the thing',
    state: TaskState.Todo,
    rawState: 'open',
    assignees: [],
    labels: [],
    url: 'https://github.com/o/r/issues/123',
    updatedAt: '2026-07-13T00:00:00Z',
    createdAt: '2026-07-01T00:00:00Z',
    gitHubRepositoryID: 7,
    ...overrides,
  }
}

describe('taskKey', () => {
  it('distinguishes the same id across providers', () => {
    assert.notStrictEqual(
      taskKey(TaskProviderId.GitHubIssues, '123'),
      taskKey(TaskProviderId.Linear, '123')
    )
  })

  it('is stable across calls', () => {
    assert.strictEqual(
      taskKey(TaskProviderId.Linear, 'ENG-431'),
      taskKey(TaskProviderId.Linear, 'ENG-431')
    )
  })

  it('does not break on an externalId containing a colon', () => {
    const key = taskKey(TaskProviderId.Jira, 'PROJ-12:sub')
    assert.strictEqual(key, 'jira:PROJ-12:sub')
  })
})

describe('mapToTaskState', () => {
  it('maps GitHub open/closed to Todo/Done', () => {
    assert.strictEqual(
      mapToTaskState(TaskProviderId.GitHubIssues, 'open'),
      TaskState.Todo
    )
    assert.strictEqual(
      mapToTaskState(TaskProviderId.GitHubIssues, 'closed'),
      TaskState.Done
    )
  })

  it("maps Linear's 'In Review' to InReview", () => {
    assert.strictEqual(
      mapToTaskState(TaskProviderId.Linear, 'In Review'),
      TaskState.InReview
    )
  })

  // The test the mapper exists for: it is allowed to admit it does not know.
  it('returns Unknown for states that do not map without ambiguity', () => {
    for (const raw of ['Blocked', "Won't Fix", '', 'Cancelled']) {
      assert.strictEqual(
        mapToTaskState(TaskProviderId.Linear, raw),
        TaskState.Unknown,
        `${raw || '(empty)'} should be Unknown`
      )
    }
  })

  it('is case-insensitive and tolerant of surrounding whitespace', () => {
    assert.strictEqual(
      mapToTaskState(TaskProviderId.Linear, '  in PROGRESS  '),
      TaskState.InProgress
    )
  })

  // Exact match only — a superstring must not resolve to the state it contains.
  it('does not match partially', () => {
    assert.strictEqual(
      mapToTaskState(TaskProviderId.Linear, 'Not In Review'),
      TaskState.Unknown
    )
  })
})

describe('slugifyTaskForBranch', () => {
  const cases: Array<{ readonly name: string; readonly title: string }> = [
    { name: 'accents', title: 'Corrigir a validação de sessão' },
    { name: 'emoji', title: '🚀 Ship the thing 🎉' },
    { name: 'slashes', title: 'feat/area: do a/b test' },
    { name: 'double spaces', title: 'too    many     spaces' },
    { name: 'very long', title: 'x'.repeat(200) },
    { name: 'only emoji', title: '🔥🔥🔥' },
  ]

  for (const { name, title } of cases) {
    it(`produces a valid, stable ref for ${name}`, () => {
      const slug = slugifyTaskForBranch(sampleTask({ title }))
      assert.ok(slug.length > 0, 'slug must be non-empty')
      assert.ok(
        /^[a-z0-9-]+$/.test(slug),
        `slug should be lowercase alphanumeric and hyphens: ${slug}`
      )
      assert.ok(!slug.startsWith('-') && !slug.endsWith('-'), 'no edge hyphens')
      // The whole point: the fork's sanitizer leaves it untouched.
      assert.strictEqual(sanitizedRefName(slug), slug)
    })
  }

  it('is deterministic', () => {
    const task = sampleTask({ title: 'Título com acento e / barra' })
    assert.strictEqual(slugifyTaskForBranch(task), slugifyTaskForBranch(task))
  })
})

// A cheap guard-rail: a task object must never carry a credential-shaped field,
// so a future provider cannot leak the key that fetched it into the cache.
describe('ITask retains no credential', () => {
  it('has no key that looks like a secret', () => {
    const task = sampleTask()
    const forbidden = /token|secret|password|apikey|credential|bearer/i
    for (const key of Object.keys(task)) {
      assert.ok(
        !forbidden.test(key),
        `unexpected credential-shaped field: ${key}`
      )
    }
  })
})
