import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  allCommands,
  resolveCommand,
  ICommandContext,
  ICommandRepository,
} from '../../src/lib/cli/registry'

describe('CLI command registry', () => {
  it('gives every command a unique name and a non-empty summary', () => {
    const seen = new Set<string>()
    for (const command of allCommands()) {
      assert.ok(command.name.length > 0, 'command name must not be empty')
      assert.ok(!seen.has(command.name), `duplicate command: ${command.name}`)
      seen.add(command.name)
      assert.ok(
        command.summary.trim().length > 0,
        `${command.name} needs a summary`
      )
    }
  })

  it('resolves a known command exactly', () => {
    assert.strictEqual(resolveCommand('ping')?.name, 'ping')
  })

  it('routes an unknown name to null, never a near match', () => {
    // `pin`/`pingg` are one edit from `ping`; a fuzzy router would return it.
    assert.strictEqual(resolveCommand('pin'), null)
    assert.strictEqual(resolveCommand('pingg'), null)
    assert.strictEqual(resolveCommand(''), null)
    assert.strictEqual(resolveCommand('context list'), null)
  })

  it('ping is a non-mutating query that needs the app', () => {
    const ping = resolveCommand('ping')
    assert.ok(ping !== null)
    assert.strictEqual(ping?.mutates, false)
    assert.strictEqual(ping?.requiresApp, true)
  })
})

describe('ping command', () => {
  function context(repository: ICommandRepository | null): ICommandContext {
    return {
      args: {},
      cwd: '/Users/x/proj/wt-a',
      resolveRepository: async () => repository,
      app: { name: 'Blackfin', appVersion: '3.6.3-beta3', pid: 41207 },
    }
  }

  it('reports the app facts and the resolved repository', async () => {
    const data = (await resolveCommand('ping')!.run(
      context({
        name: 'proj',
        gitDir: '/Users/x/proj/.git',
        worktree: '/Users/x/proj/wt-a',
      })
    )) as Record<string, unknown>

    assert.strictEqual(data.app, 'Blackfin')
    assert.strictEqual(data.appVersion, '3.6.3-beta3')
    assert.strictEqual(data.protocol, 1)
    assert.strictEqual(data.pid, 41207)
    assert.strictEqual(data.cwd, '/Users/x/proj/wt-a')
    assert.deepStrictEqual(data.repository, {
      name: 'proj',
      gitDir: '/Users/x/proj/.git',
      worktree: '/Users/x/proj/wt-a',
    })
  })

  it('reports a null repository when the cwd is outside any known repo', async () => {
    const data = (await resolveCommand('ping')!.run(context(null))) as Record<
      string,
      unknown
    >
    assert.strictEqual(data.repository, null)
  })
})
