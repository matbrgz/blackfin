import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  TestPullRequestDatabase,
  TestRepositoriesDatabase,
} from '../helpers/databases'
import { RepositoriesStore, PullRequestStore } from '../../src/lib/stores'
import { IAPIFullRepository, getDotComAPIEndpoint } from '../../src/lib/api'
import {
  IPullRequest,
  PullRequestDatabase,
} from '../../src/lib/databases/pull-request-database'
import { GitHubRepository } from '../../src/models/github-repository'
import { PullRequestState } from '../../src/models/pull-request'

const apiRepository: IAPIFullRepository = {
  clone_url: 'https://github.com/my-user/my-repo',
  ssh_url: 'git@github.com:my-user/my-repo.git',
  html_url: 'https://github.com/my-user/my-repo',
  name: 'my-repo',
  owner: {
    id: 42,
    html_url: 'https://github.com/my-user',
    login: 'my-user',
    avatar_url: '',
    type: 'User',
  },
  private: false,
  fork: false,
  default_branch: 'main',
  pushed_at: '2026-01-01T00:00:00Z',
  has_issues: true,
  archived: false,
  parent: undefined,
}

describe('PullRequestStore', () => {
  let reposDb: TestRepositoriesDatabase
  let prDb: TestPullRequestDatabase
  let store: PullRequestStore
  let ghRepo: GitHubRepository

  beforeEach(async () => {
    reposDb = new TestRepositoriesDatabase()
    await reposDb.reset()
    const reposStore = new RepositoriesStore(reposDb)
    ghRepo = await reposStore.upsertGitHubRepository(
      getDotComAPIEndpoint(),
      apiRepository,
      null
    )

    prDb = new TestPullRequestDatabase()
    await prDb.reset()
    store = new PullRequestStore(prDb, reposStore)
  })

  afterEach(async () => {
    await prDb.close()
    await reposDb.close()
  })

  function row(
    prNumber: number,
    state: PullRequestState,
    headRef: string
  ): IPullRequest {
    return {
      number: prNumber,
      title: `pr ${prNumber}`,
      body: '',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      head: { ref: headRef, sha: 's', repoId: ghRepo.dbID! },
      base: { ref: 'main', sha: 's', repoId: ghRepo.dbID! },
      author: 'a',
      draft: false,
      state,
      mergedAt: state === 'merged' ? '2026-07-01T00:00:00Z' : null,
      closedAt: state === 'open' ? null : '2026-07-01T00:00:00Z',
    }
  }

  it('keeps a closed PR in the table instead of deleting it', async () => {
    await prDb.putPullRequests([row(1, 'closed', 'fix/old')])
    const stored = await prDb.getPullRequest(ghRepo, 1)
    assert.ok(stored !== undefined)
    assert.strictEqual(stored.state, 'closed')
  })

  it('stores a merged PR with its merge timestamp', async () => {
    await prDb.putPullRequests([row(2, 'merged', 'feat/x')])
    const stored = await prDb.getPullRequest(ghRepo, 2)
    assert.strictEqual(stored?.state, 'merged')
    assert.ok(stored?.mergedAt != null)
  })

  it('getAll returns only open PRs, even with closed and merged present', async () => {
    await prDb.putPullRequests([
      row(1, 'open', 'fix/live'),
      row(2, 'closed', 'fix/old'),
      row(3, 'merged', 'feat/done'),
    ])
    const open = await store.getAll(ghRepo)
    assert.strictEqual(open.length, 1)
    assert.strictEqual(open[0].pullRequestNumber, 1)
    assert.strictEqual(open[0].state, 'open')
  })

  it('getForHeadRefs returns the PR for a branch, with its state', async () => {
    await prDb.putPullRequests([
      row(1, 'open', 'fix/live'),
      row(3, 'merged', 'feat/done'),
    ])
    const forBranch = await store.getForHeadRefs(ghRepo, ['feat/done'])
    assert.strictEqual(forBranch.length, 1)
    assert.strictEqual(forBranch[0].pullRequestNumber, 3)
    assert.strictEqual(forBranch[0].state, 'merged')
    assert.ok(forBranch[0].mergedAt != null)
  })

  it('getAllWithState filters to the requested states', async () => {
    await prDb.putPullRequests([
      row(1, 'open', 'a'),
      row(2, 'closed', 'b'),
      row(3, 'merged', 'c'),
    ])
    const done = await store.getAllWithState(ghRepo, ['closed', 'merged'])
    assert.deepStrictEqual(done.map(p => p.pullRequestNumber).sort(), [2, 3])
  })
})

describe('PullRequestDatabase migration', () => {
  it('clears the tables on the version 9 → 10 upgrade', async () => {
    const name = 'pr-migration-v9-v10-test'

    const db9 = new PullRequestDatabase(name, 9)
    await db9.open()
    await db9.pullRequests.bulkPut([
      {
        number: 1,
        title: 't',
        body: '',
        createdAt: '',
        updatedAt: '',
        head: { ref: 'h', sha: 's', repoId: 1 },
        base: { ref: 'b', sha: 's', repoId: 1 },
        author: 'a',
        draft: false,
        // A version-9 row has no state/mergedAt/closedAt.
      } as any,
    ])
    await db9.pullRequestsLastUpdated.put({ repoId: 1, lastUpdated: 123 })
    await db9.close()

    const db10 = new PullRequestDatabase(name, 10)
    await db10.open()
    assert.strictEqual((await db10.pullRequests.toArray()).length, 0)
    assert.strictEqual((await db10.pullRequestsLastUpdated.toArray()).length, 0)
    await db10.delete()
  })
})
