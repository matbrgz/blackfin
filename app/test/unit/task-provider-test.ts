import { describe, it } from 'node:test'
import assert from 'node:assert'
import { TaskProviderId, TaskState } from '../../src/models/task'
import {
  ITaskProviderConnection,
  TaskProviderConnectionState,
} from '../../src/models/task-provider'
import { IAPIIdentity, IAPIIssue } from '../../src/lib/api'
import {
  GitHubIssuesProvider,
  IGitHubIssuesDataSource,
  IGitHubRepositoryRef,
} from '../../src/lib/tasks/github-issues-provider'
import {
  attemptTaskProviderIO,
  ITaskProvider,
  ITaskProviderContext,
  providerCanWriteState,
  TaskProviderErrorCode,
  taskProviderError,
  taskProviderOk,
} from '../../src/lib/tasks/task-provider'

const IDENTITY: IAPIIdentity = {
  id: 1,
  login: 'octocat',
  avatar_url: 'https://avatars.example/octocat.png',
  html_url: 'https://github.com/octocat',
  type: 'User',
}

function issue(overrides: Partial<IAPIIssue> = {}): IAPIIssue {
  return {
    id: 999,
    number: 123,
    title: 'Fix the flaky login test',
    state: 'open',
    updated_at: '2026-07-13T10:00:00Z',
    created_at: '2026-07-01T08:00:00Z',
    html_url: 'https://github.com/owner/repo/issues/123',
    ...overrides,
  }
}

const REPO_CONTEXT: ITaskProviderContext = {
  gitHubRepositoryID: 42,
  scopeId: null,
}

const NO_REPO_CONTEXT: ITaskProviderContext = {
  gitHubRepositoryID: null,
  scopeId: null,
}

// A configurable fake transport. Every method defaults to a benign happy path;
// a test overrides only the one it exercises, including with a rejecting stub to
// prove the provider never lets the rejection escape.
function fakeDataSource(
  overrides: Partial<IGitHubIssuesDataSource> = {}
): IGitHubIssuesDataSource {
  return {
    fetchIdentity: async () => IDENTITY,
    fetchIssues: async () => [issue()],
    fetchIssue: async () => issue(),
    fetchRepositories: async (): Promise<
      ReadonlyArray<IGitHubRepositoryRef>
    > => [{ dbID: 42, fullName: 'owner/repo' }],
    ...overrides,
  }
}

/** An error that carries an HTTP status, like the API layer raises. */
function httpError(
  status: number,
  message: string
): Error & { status: number } {
  const error: Error & { status: number } = Object.assign(new Error(message), {
    status,
  })
  return error
}

describe('TaskProviderResult helpers', () => {
  it('taskProviderOk carries the value', () => {
    const result = taskProviderOk(7)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.ok && result.value, 7)
  })

  it('taskProviderError carries the code and message, omits status when absent', () => {
    const result = taskProviderError(TaskProviderErrorCode.Unavailable, 'down')
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.code, TaskProviderErrorCode.Unavailable)
      assert.strictEqual(result.error.message, 'down')
      assert.ok(!('httpStatus' in result.error))
    }
  })

  it('taskProviderError includes the status when given', () => {
    const result = taskProviderError(
      TaskProviderErrorCode.NotFound,
      'gone',
      404
    )
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.httpStatus, 404)
    }
  })
})

describe('attemptTaskProviderIO', () => {
  it('wraps a resolved value as ok', async () => {
    const result = await attemptTaskProviderIO(
      async () => 'value',
      () => ({ code: TaskProviderErrorCode.Unknown, message: 'x' })
    )
    assert.deepStrictEqual(result, { ok: true, value: 'value' })
  })

  it('turns a rejection into an error result rather than throwing', async () => {
    const result = await attemptTaskProviderIO(
      async () => {
        throw new Error('boom')
      },
      error => ({
        code: TaskProviderErrorCode.Unavailable,
        message: error instanceof Error ? error.message : 'unknown',
      })
    )
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.message, 'boom')
    }
  })
})

describe('GitHubIssuesProvider satisfies ITaskProvider', () => {
  it('declares its id and capabilities', () => {
    const provider: ITaskProvider = new GitHubIssuesProvider(fakeDataSource())
    assert.strictEqual(provider.id, TaskProviderId.GitHubIssues)
    assert.deepStrictEqual(provider.capabilities, {
      canReadTasks: true,
      canWriteState: false,
      incrementalRefresh: true,
      providesScopes: true,
      usesGitAccount: true,
    })
  })

  it('is read-only: it has no setState and providerCanWriteState is false', () => {
    // Typed as the interface, where `setState` is the optional method — the
    // concrete class does not declare it at all, which is the point.
    const provider: ITaskProvider = new GitHubIssuesProvider(fakeDataSource())
    // The whole point of the optional method: a read-only provider simply does
    // not have it, instead of stubbing a lie.
    assert.strictEqual(provider.setState, undefined)
    assert.strictEqual(providerCanWriteState(provider), false)
  })

  it('validate maps the authenticated identity', async () => {
    const provider = new GitHubIssuesProvider(fakeDataSource())
    const result = await provider.validate()
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.value.displayName, 'octocat')
      assert.strictEqual(result.value.externalId, '1')
    }
  })

  it('listTasks maps issues for a repository context', async () => {
    const provider = new GitHubIssuesProvider(
      fakeDataSource({
        fetchIssues: async () => [issue(), issue({ number: 9 })],
      })
    )
    const result = await provider.listTasks(REPO_CONTEXT, null)
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.value.length, 2)
      assert.strictEqual(result.value[0].gitHubRepositoryID, 42)
      assert.strictEqual(result.value[0].displayId, '#123')
    }
  })

  it('listTasks with no repository in focus is NoScope, not empty and not a throw', async () => {
    const provider = new GitHubIssuesProvider(fakeDataSource())
    const result = await provider.listTasks(NO_REPO_CONTEXT, null)
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.code, TaskProviderErrorCode.NoScope)
    }
  })

  it('getTask resolves a single issue by key', async () => {
    const provider = new GitHubIssuesProvider(fakeDataSource())
    const result = await provider.getTask(REPO_CONTEXT, 'github-issues:123')
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.strictEqual(result.value.externalId, '123')
    }
  })

  it('getTask reports NotFound when the issue is absent', async () => {
    const provider = new GitHubIssuesProvider(
      fakeDataSource({ fetchIssue: async () => null })
    )
    const result = await provider.getTask(REPO_CONTEXT, 'github-issues:123')
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.code, TaskProviderErrorCode.NotFound)
    }
  })

  it('listScopes maps repositories to scopes', async () => {
    const provider = new GitHubIssuesProvider(fakeDataSource())
    const result = await provider.listScopes()
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.deepStrictEqual(result.value, [
        { id: '42', displayName: 'owner/repo' },
      ])
    }
  })

  it('listStates returns exactly open and closed, mapped to Todo and Done', async () => {
    const provider = new GitHubIssuesProvider(fakeDataSource())
    const result = await provider.listStates(null)
    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.deepStrictEqual(
        result.value.map(s => [s.id, s.taskState]),
        [
          ['open', TaskState.Todo],
          ['closed', TaskState.Done],
        ]
      )
    }
  })
})

describe('GitHubIssuesProvider never throws on a failing transport', () => {
  // A provider is an I/O boundary; a Linear/GitHub outage is a value, not an
  // exception (#75). A data source that rejects on every call must still leave
  // every method resolving to a `{ ok: false }` result.
  const rejecting = fakeDataSource({
    fetchIdentity: async () => {
      throw httpError(500, 'server error')
    },
    fetchIssues: async () => {
      throw httpError(503, 'unavailable')
    },
    fetchIssue: async () => {
      throw httpError(500, 'server error')
    },
    fetchRepositories: async () => {
      throw new Error('network down')
    },
  })

  it('validate resolves to an error result', async () => {
    const result = await new GitHubIssuesProvider(rejecting).validate()
    assert.strictEqual(result.ok, false)
  })

  it('listTasks resolves to an error result', async () => {
    const result = await new GitHubIssuesProvider(rejecting).listTasks(
      REPO_CONTEXT,
      null
    )
    assert.strictEqual(result.ok, false)
  })

  it('listScopes resolves to an error result', async () => {
    const result = await new GitHubIssuesProvider(rejecting).listScopes()
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      // A rejection with no HTTP status degrades to Unavailable, not a crash.
      assert.strictEqual(result.error.code, TaskProviderErrorCode.Unavailable)
    }
  })

  it('maps a 401 to Unauthorized without carrying the request', async () => {
    const provider = new GitHubIssuesProvider(
      fakeDataSource({
        fetchIdentity: async () => {
          throw httpError(401, 'Bad credentials')
        },
      })
    )
    const result = await provider.validate()
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.error.code, TaskProviderErrorCode.Unauthorized)
      assert.strictEqual(result.error.httpStatus, 401)
      // The error carries the provider's message and a status — never a header.
      const forbidden = /token|secret|password|apikey|bearer|authorization/i
      assert.ok(!forbidden.test(JSON.stringify(result.error)))
    }
  })
})

describe('ITaskProviderConnection carries no secret', () => {
  // The central security invariant of #75: a persisted connection never has a
  // field that could hold the credential. The secret lives only in the keychain.
  it('has no field whose name looks like a secret', () => {
    const connection: ITaskProviderConnection = {
      providerId: TaskProviderId.Linear,
      label: 'work',
      endpoint: null,
      identityDisplayName: 'Fulano',
      connectedAt: 1000,
      lastValidatedAt: 2000,
      lastValidationState: TaskProviderConnectionState.Connected,
    }
    const forbidden = /token|secret|password|key|bearer|apikey|credential/i
    for (const field of Object.keys(connection)) {
      assert.ok(
        !forbidden.test(field),
        `unexpected credential-shaped field: ${field}`
      )
    }
    // And serializing it produces no secret-shaped substring either.
    assert.ok(!forbidden.test(JSON.stringify(connection)))
  })
})
