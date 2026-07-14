import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IAPIPullRequest,
  IBitbucketAPIPullRequest,
  IGitLabAPIMergeRequest,
  toIAPIPullRequest,
  toIAPIPullRequestFromGitLab,
} from '../../src/lib/api'
import { toPullRequestState } from '../../src/lib/pull-request-state'

function githubPR(
  state: 'open' | 'closed',
  merged_at: string | null
): IAPIPullRequest {
  return {
    number: 1,
    title: 't',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    user: { id: 1, login: 'x', avatar_url: '', html_url: '', type: 'User' },
    head: { ref: 'h', sha: 's', repo: null },
    base: { ref: 'b', sha: 's', repo: null },
    body: '',
    state,
    merged_at,
  }
}

describe('toPullRequestState', () => {
  it('is open for an open PR', () => {
    assert.strictEqual(toPullRequestState(githubPR('open', null)), 'open')
  })

  it('is closed for a closed PR that was not merged', () => {
    assert.strictEqual(toPullRequestState(githubPR('closed', null)), 'closed')
  })

  // The precedence that matters: on GitHub a merged PR is *also* closed.
  it('is merged for a closed PR with a merge timestamp', () => {
    assert.strictEqual(
      toPullRequestState(githubPR('closed', '2026-07-01T00:00:00Z')),
      'merged'
    )
  })
})

function bitbucketPR(
  state: 'OPEN' | 'MERGED' | 'DECLINED'
): IBitbucketAPIPullRequest {
  const ref = {
    branch: { name: 'b' },
    commit: { hash: 's' },
    repository: {
      uuid: 'u',
      full_name: 'o/r',
      name: 'r',
      links: { html: { href: '' } },
    },
  }
  return {
    id: 1,
    title: 't',
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-07-01T00:00:00Z',
    author: {
      uuid: 'a',
      display_name: 'A',
      username: 'a',
      links: { avatar: { href: '' }, html: { href: '' } },
    },
    source: ref,
    destination: ref,
    description: '',
    state,
    type: 'pullrequest',
  }
}

describe('toIAPIPullRequest (Bitbucket) propagates merge', () => {
  it('fills merged_at for a MERGED PR, which reads as merged', () => {
    const pr = toIAPIPullRequest(bitbucketPR('MERGED'))
    assert.ok(pr.merged_at != null)
    assert.strictEqual(toPullRequestState(pr), 'merged')
  })

  it('leaves a DECLINED PR closed with no merge timestamp', () => {
    const pr = toIAPIPullRequest(bitbucketPR('DECLINED'))
    assert.strictEqual(pr.merged_at ?? null, null)
    assert.strictEqual(toPullRequestState(pr), 'closed')
  })
})

function gitlabMR(
  state: 'opened' | 'closed' | 'locked' | 'merged'
): IGitLabAPIMergeRequest {
  return {
    iid: 1,
    title: 't',
    description: '',
    state,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    author: { id: 1, username: 'a', name: 'A', avatar_url: '', web_url: '' },
    source_branch: 'b',
    target_branch: 'main',
    source_project_id: 1,
    target_project_id: 1,
    sha: 's',
    draft: false,
    web_url: '',
  }
}

describe('toIAPIPullRequestFromGitLab propagates merge', () => {
  it('reads a merged MR as merged', () => {
    const pr = toIAPIPullRequestFromGitLab(gitlabMR('merged'), null, null)
    assert.strictEqual(toPullRequestState(pr), 'merged')
  })

  // `locked` is not an end of life, so it should read as open, not closed.
  it('reads a locked MR as open', () => {
    const pr = toIAPIPullRequestFromGitLab(gitlabMR('locked'), null, null)
    assert.strictEqual(toPullRequestState(pr), 'open')
  })
})
