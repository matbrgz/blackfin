import { describe, it } from 'node:test'
import assert from 'node:assert'
import { TaskProviderId, TaskState } from '../../src/models/task'
import { IAPIIssue } from '../../src/lib/api'
import { apiIssueToTask } from '../../src/lib/tasks/github-issues-provider'

// A representative, fully-populated GitHub REST issue payload. The mapper's
// happy path is measured against this.
function fullIssue(overrides: Partial<IAPIIssue> = {}): IAPIIssue {
  return {
    id: 999,
    number: 123,
    title: 'Fix the flaky login test',
    state: 'open',
    updated_at: '2026-07-13T10:00:00Z',
    created_at: '2026-07-01T08:00:00Z',
    html_url: 'https://github.com/owner/repo/issues/123',
    body: 'Steps to reproduce...',
    state_reason: null,
    user: {
      id: 1,
      login: 'octocat',
      avatar_url: 'https://avatars.example/octocat.png',
      html_url: 'https://github.com/octocat',
      type: 'User',
    },
    assignees: [
      {
        id: 2,
        login: 'hubot',
        avatar_url: 'https://avatars.example/hubot.png',
        html_url: 'https://github.com/hubot',
        type: 'User',
      },
    ],
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'p1', color: 'b60205' },
    ],
    ...overrides,
  }
}

// The narrow payload the fork used to type before #73 extended `IAPIIssue` —
// only the original four fields. Constructing it must still compile (the new
// fields are optional) and must map without throwing.
function legacyIssue(overrides: Partial<IAPIIssue> = {}): IAPIIssue {
  return {
    number: 7,
    title: 'A minimal issue',
    state: 'open',
    updated_at: '2026-07-13T10:00:00Z',
    ...overrides,
  }
}

const REPO_ID = 42

describe('apiIssueToTask', () => {
  it('maps a complete issue payload to the expected task', () => {
    const task = apiIssueToTask(fullIssue(), REPO_ID)

    assert.strictEqual(task.providerId, TaskProviderId.GitHubIssues)
    assert.strictEqual(task.providerId, 'github-issues')
    assert.strictEqual(task.externalId, '123')
    assert.strictEqual(task.displayId, '#123')
    assert.strictEqual(task.title, 'Fix the flaky login test')
    assert.strictEqual(task.url, 'https://github.com/owner/repo/issues/123')
    assert.strictEqual(task.updatedAt, '2026-07-13T10:00:00Z')
    assert.strictEqual(task.createdAt, '2026-07-01T08:00:00Z')
    assert.strictEqual(task.gitHubRepositoryID, REPO_ID)
    assert.strictEqual(task.rawState, 'open')
    assert.strictEqual(task.state, TaskState.Todo)
  })

  it('maps assignees to their id, login and avatar', () => {
    const task = apiIssueToTask(fullIssue(), REPO_ID)

    assert.deepStrictEqual(task.assignees, [
      {
        externalId: '2',
        displayName: 'hubot',
        avatarURL: 'https://avatars.example/hubot.png',
      },
    ])
  })

  it('maps labels keeping the hex colour without a leading hash', () => {
    const task = apiIssueToTask(fullIssue(), REPO_ID)

    assert.deepStrictEqual(task.labels, [
      { name: 'bug', color: 'd73a4a' },
      { name: 'p1', color: 'b60205' },
    ])
  })

  it('maps a closed issue to TaskState.Done, keeping the raw state', () => {
    const task = apiIssueToTask(fullIssue({ state: 'closed' }), REPO_ID)

    assert.strictEqual(task.state, TaskState.Done)
    assert.strictEqual(task.rawState, 'closed')
  })

  it('maps an open issue to TaskState.Todo', () => {
    const task = apiIssueToTask(fullIssue({ state: 'open' }), REPO_ID)

    assert.strictEqual(task.state, TaskState.Todo)
  })

  // The backward-compatibility test for the extended type: a payload with none
  // of the new fields (the shape the fork typed before #73) must map without
  // throwing, with empty arrays and safe fallbacks.
  it('maps a legacy payload (no assignees, labels, body or html_url) without throwing', () => {
    const task = apiIssueToTask(
      legacyIssue({ body: null } as Partial<IAPIIssue>),
      REPO_ID
    )

    assert.deepStrictEqual(task.assignees, [])
    assert.deepStrictEqual(task.labels, [])
    assert.strictEqual(task.url, '')
    // No `created_at` on the payload: fall back to `updated_at`, never a throw.
    assert.strictEqual(task.createdAt, task.updatedAt)
    assert.strictEqual(task.externalId, '7')
    assert.strictEqual(task.displayId, '#7')
  })

  it('treats an empty avatar or label colour as null', () => {
    const task = apiIssueToTask(
      fullIssue({
        assignees: [
          {
            id: 3,
            login: 'ghost',
            avatar_url: '',
            html_url: 'https://github.com/ghost',
            type: 'User',
          },
        ],
        labels: [{ name: 'uncoloured', color: '' }],
      }),
      REPO_ID
    )

    assert.strictEqual(task.assignees[0].avatarURL, null)
    assert.strictEqual(task.labels[0].color, null)
  })

  // The security invariant of #72, enforced at the mapper boundary: nothing the
  // provider produces may carry a credential-shaped field into the cache.
  it('produces a task with no credential-shaped key', () => {
    const task = apiIssueToTask(fullIssue(), REPO_ID)
    const forbidden = /token|secret|password|apikey|credential|bearer/i

    for (const key of Object.keys(task)) {
      assert.ok(
        !forbidden.test(key),
        `unexpected credential-shaped key: ${key}`
      )
    }
  })
})
