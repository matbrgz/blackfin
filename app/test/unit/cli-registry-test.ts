import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  allCommands,
  resolveCommand,
  ICommandContext,
  ICommandRepository,
} from '../../src/lib/cli/registry'
import { CLIProtocolVersion } from '../../src/lib/cli/protocol'

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
    // `context` alone is not a command — only its subcommands are. A fuzzy
    // router would resolve it to `context list`; exact resolution must not.
    assert.strictEqual(resolveCommand('context'), null)
    assert.strictEqual(resolveCommand('context frobnicate'), null)
  })

  it('ping is a non-mutating query that needs the app', () => {
    const ping = resolveCommand('ping')
    assert.ok(ping !== null)
    assert.strictEqual(ping?.mutates, false)
    assert.strictEqual(ping?.requiresApp, true)
  })

  it('names commands in kebab-case, subcommands as "<group> <verb>"', () => {
    // Each space-separated segment is lowercase kebab-case — never camelCase
    // like `contextEffective`, which an agent reading the schema would not type.
    const segment = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
    for (const command of allCommands()) {
      for (const part of command.name.split(' ')) {
        assert.match(part, segment, `${command.name} is not kebab-case`)
      }
    }
  })

  it('capabilities is a non-mutating command that does not need the app', () => {
    const cap = resolveCommand('capabilities')
    assert.ok(cap !== null)
    assert.strictEqual(cap?.mutates, false)
    assert.strictEqual(cap?.requiresApp, false)
    assert.strictEqual(cap?.confirmation, 'none')
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
    assert.strictEqual(data.protocol, CLIProtocolVersion)
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
