import { describe, it } from 'node:test'
import assert from 'node:assert'
import { resolveCwd, ICwdRepository } from '../../src/lib/cli/resolve-cwd'

function repo(
  name: string,
  commonGitDir: string,
  worktrees: ReadonlyArray<{
    path: string
    branch?: string | null
    isMain?: boolean
  }>
): ICwdRepository {
  return {
    name,
    commonGitDir,
    worktrees: worktrees.map(w => ({
      path: w.path,
      branch: w.branch ?? null,
      isMain: w.isMain ?? false,
    })),
  }
}

describe('resolveCwd', () => {
  const proj = repo('proj', '/Users/x/proj/.git', [
    { path: '/Users/x/proj', branch: 'refs/heads/main', isMain: true },
    { path: '/Users/x/proj-wt/auth', branch: 'refs/heads/feat/auth' },
  ])

  it('resolves a cwd exactly at a worktree root', () => {
    const r = resolveCwd('/Users/x/proj', [proj])
    assert.strictEqual(r.kind, 'resolved')
    assert.strictEqual(r.kind === 'resolved' && r.worktree.isMain, true)
    assert.strictEqual(
      r.kind === 'resolved' && r.repository.commonGitDir,
      '/Users/x/proj/.git'
    )
  })

  it('resolves a cwd nested below a worktree root', () => {
    const r = resolveCwd('/Users/x/proj-wt/auth/src/lib', [proj])
    assert.strictEqual(r.kind, 'resolved')
    assert.strictEqual(
      r.kind === 'resolved' && r.worktree.branch,
      'refs/heads/feat/auth'
    )
  })

  it('returns not-in-repository when the cwd is under no worktree', () => {
    assert.strictEqual(
      resolveCwd('/Users/x/somewhere-else', [proj]).kind,
      'not-in-repository'
    )
  })

  it('does not match a sibling directory with a shared string prefix', () => {
    // `/Users/x/proj-sibling` shares the prefix `/Users/x/proj` but is not
    // inside it — a naive startsWith would wrongly match.
    assert.strictEqual(
      resolveCwd('/Users/x/proj-sibling/src', [proj]).kind,
      'not-in-repository'
    )
  })

  it('picks the most specific (longest) root when worktrees nest', () => {
    // An inner repository checked out inside the outer repo's worktree.
    const outer = repo('outer', '/Users/x/outer/.git', [
      { path: '/Users/x/outer', isMain: true },
    ])
    const inner = repo('inner', '/Users/x/outer/vendor/inner/.git', [
      { path: '/Users/x/outer/vendor/inner', isMain: true },
    ])
    const r = resolveCwd('/Users/x/outer/vendor/inner/src', [outer, inner])
    assert.strictEqual(r.kind, 'resolved')
    assert.strictEqual(r.kind === 'resolved' && r.repository.name, 'inner')
  })

  it('is independent of the order repositories are given', () => {
    const outer = repo('outer', '/Users/x/o/.git', [{ path: '/Users/x/o' }])
    const inner = repo('inner', '/Users/x/o/in/.git', [
      { path: '/Users/x/o/in' },
    ])
    const cwd = '/Users/x/o/in/deep'
    const a = resolveCwd(cwd, [outer, inner])
    const b = resolveCwd(cwd, [inner, outer])
    assert.strictEqual(a.kind === 'resolved' && a.repository.name, 'inner')
    assert.strictEqual(b.kind === 'resolved' && b.repository.name, 'inner')
  })

  it('normalizes trailing slashes and "." segments in the cwd', () => {
    const r = resolveCwd('/Users/x/proj-wt/auth/./src/../', [proj])
    assert.strictEqual(r.kind, 'resolved')
    assert.strictEqual(
      r.kind === 'resolved' && r.worktree.branch,
      'refs/heads/feat/auth'
    )
  })

  it('picks the right worktree among several of one repository', () => {
    const r = resolveCwd('/Users/x/proj', [proj])
    assert.strictEqual(
      r.kind === 'resolved' && r.worktree.path,
      '/Users/x/proj'
    )
    const r2 = resolveCwd('/Users/x/proj-wt/auth', [proj])
    assert.strictEqual(
      r2.kind === 'resolved' && r2.worktree.path,
      '/Users/x/proj-wt/auth'
    )
  })

  it('returns not-in-repository for an empty registry', () => {
    assert.strictEqual(resolveCwd('/anywhere', []).kind, 'not-in-repository')
  })
})
