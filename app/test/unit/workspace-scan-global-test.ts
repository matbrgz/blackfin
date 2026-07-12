import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { scanGlobalContext } from '../../src/lib/workspace/scan-global'
import {
  AgentId,
  ContextRole,
  ContextScope,
} from '../../src/models/workspace-inventory'

let home: string

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = Path.join(home, relativePath)
  await mkdir(Path.dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

const scan = () => scanGlobalContext(home, 1234)

describe('scanGlobalContext', () => {
  beforeEach(async () => {
    home = await mkdtemp(Path.join(tmpdir(), 'blackfin-home-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('finds the user-level instructions that apply to every project', async () => {
    await write('.claude/CLAUDE.md', '# Me\n\n- Always use tabs\n')

    const context = await scan()
    const file = context.contextFiles[0]

    assert.equal(file.relativePath, '.claude/CLAUDE.md')
    assert.equal(file.agent, AgentId.ClaudeCode)
    assert.equal(file.role, ContextRole.Instructions)
    // The point of the whole exercise: this rule reaches every repository, and
    // is invisible from inside all of them.
    assert.equal(file.scope, ContextScope.Global)
    assert.equal(file.ruleCount, 1)
  })

  it('finds global skills, commands and subagents', async () => {
    await write(
      '.claude/skills/deploy/SKILL.md',
      '---\nname: deploy\ndescription: Ships it\n---\n# Deploy\n'
    )
    await write('.claude/commands/review.md', '# Review\n')
    await write('.claude/agents/explorer.md', '# Explorer\n')

    const context = await scan()
    const roles = context.contextFiles.map(f => f.role).sort()

    assert.deepEqual(
      roles,
      [ContextRole.Command, ContextRole.Skill, ContextRole.Subagent].sort()
    )

    const skill = context.contextFiles.find(f => f.role === ContextRole.Skill)!
    assert.equal(skill.name, 'deploy')
    assert.equal(skill.description, 'Ships it')
  })

  it('finds context for several agents at once', async () => {
    await write('.claude/CLAUDE.md', '# a\n')
    await write('.codex/config.toml', 'model = "x"\n')
    await write('.gemini/GEMINI.md', '# c\n')

    const agents = [...new Set((await scan()).contextFiles.map(f => f.agent))]

    assert.ok(agents.includes(AgentId.ClaudeCode))
    assert.ok(agents.includes(AgentId.Codex))
    assert.ok(agents.includes(AgentId.Gemini))
  })

  it('reports a broken reference in a global instruction file', async () => {
    await write('.claude/CLAUDE.md', 'See @notes/deleted.md.\n')

    const context = await scan()

    assert.equal(context.contextFiles[0].references[0].exists, false)
  })

  it('treats an agent that is not installed as an answer, not an error', async () => {
    const context = await scan()

    assert.deepEqual(context.status, { kind: 'ok' })
    assert.deepEqual(context.contextFiles, [])
  })

  it('does not walk the home directory itself', async () => {
    // Only the known agent directories. Walking somebody's whole home folder
    // would be both slow and rude.
    await write('Documents/CLAUDE.md', '# not agent context\n')
    await write('.claude/CLAUDE.md', '# real\n')

    const context = await scan()

    assert.deepEqual(
      context.contextFiles.map(f => f.relativePath),
      ['.claude/CLAUDE.md']
    )
  })
})
