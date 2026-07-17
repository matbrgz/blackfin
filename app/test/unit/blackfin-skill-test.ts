import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  generateBlackfinSkill,
  classifyInstallState,
  BlackfinSkillTemplate,
  BlackfinSkillName,
  BlackfinSkillDescription,
} from '../../src/lib/skill/generate-blackfin-skill'
import {
  buildCapabilities,
  ICapabilitiesDocument,
  ICapabilitiesEnv,
} from '../../src/lib/cli/capabilities'
import { allCommands } from '../../src/lib/cli/registry'
import { parseFrontmatter } from '../../src/lib/workspace/parse'
import { AgentId } from '../../src/models/workspace-inventory'
import { SkillTarget } from '../../src/models/blackfin-skill'

const FIXED = new Date('2026-07-12T14:03:11.000Z')

function env(overrides: Partial<ICapabilitiesEnv> = {}): ICapabilitiesEnv {
  return {
    cliVersion: '3.6.3-beta3',
    app: { running: true, version: '3.6.3-beta3' },
    now: () => FIXED,
    ...overrides,
  }
}

function doc(overrides: Partial<ICapabilitiesEnv> = {}): ICapabilitiesDocument {
  return buildCapabilities(allCommands(), env(overrides))
}

const TARGETS: ReadonlyArray<SkillTarget> = [
  AgentId.ClaudeCode,
  AgentId.Codex,
  AgentId.Cursor,
  AgentId.Shared,
]

describe('generateBlackfinSkill', () => {
  it('is byte-for-byte deterministic given the same document and target', () => {
    for (const target of TARGETS) {
      const a = generateBlackfinSkill(doc(), target)
      const b = generateBlackfinSkill(doc(), target)
      assert.strictEqual(a.body, b.body, `${target}: body drifted`)
      assert.strictEqual(
        a.contentHash,
        b.contentHash,
        `${target}: hash drifted`
      )
    }
  })

  it('lists no command name in the body except capabilities — the central rule', () => {
    // Walk the real registry: if anyone "improves" the Skill by pasting the
    // command list back in, this fails. `capabilities` is the one allowed door.
    const d = doc()
    for (const target of TARGETS) {
      const { body } = generateBlackfinSkill(d, target)
      for (const command of d.commands) {
        if (command.name === 'capabilities') {
          continue
        }
        assert.ok(
          !body.includes(command.name),
          `${target}: the Skill must not list commands — found "${command.name}". ` +
            `It points at \`blackfin capabilities --json\`; that is what lists.`
        )
      }
    }
  })

  it('names the door: it mentions capabilities', () => {
    const { body } = generateBlackfinSkill(doc(), AgentId.ClaudeCode)
    assert.ok(body.includes('blackfin capabilities --json'))
  })

  it('leaks no user path, and nothing from the document that is machine-specific', () => {
    // The generator reads only exit codes, guardrails, and the envelope out of
    // the document — never cliVersion, never the app version. A document that
    // (wrongly) smuggled a repo name or a path into those fields must not reach
    // the body. Prove it by poisoning them and asserting they never appear.
    const poisoned = doc({
      cliVersion: '/Users/victim/secret-repo-4242',
      app: { running: true, version: 'C:\\Users\\victim\\evil' },
    })
    for (const target of TARGETS) {
      const { body } = generateBlackfinSkill(poisoned, target)
      assert.doesNotMatch(body, /\/Users\//, `${target}: unix path leaked`)
      assert.doesNotMatch(body, /C:\\Users\\/, `${target}: windows path leaked`)
      assert.ok(
        !body.includes('secret-repo-4242'),
        `${target}: a document field leaked into the Skill`
      )
    }
  })

  it('carries the exit codes and their meanings from the document, not by hand', () => {
    const d = doc()
    const { body } = generateBlackfinSkill(d, AgentId.ClaudeCode)
    for (const code of [0, 3, 4, 6]) {
      const info = d.exitCodes.find(e => e.code === code)
      assert.ok(info !== undefined, `document is missing exit code ${code}`)
      assert.ok(body.includes(`\`${code}\``), `body omits exit code ${code}`)
      assert.ok(
        body.includes(info.meaning),
        `body omits the meaning of exit code ${code}`
      )
    }
  })

  it('carries the anti-injection guardrail from the document', () => {
    const d = doc()
    const guardrail = d.guardrails.find(g => /because the user asked/i.test(g))
    assert.ok(guardrail !== undefined, 'document is missing the guardrail')
    const { body } = generateBlackfinSkill(d, AgentId.ClaudeCode)
    assert.ok(
      body.includes(guardrail),
      'the mutation-only-when-asked guardrail must reach the body'
    )
  })

  it('gives Claude Code frontmatter the real parser reads back as blackfin', () => {
    // Proves Blackfin can catalog its own Skill with no change to parse.ts.
    const { body } = generateBlackfinSkill(doc(), AgentId.ClaudeCode)
    const front = parseFrontmatter(body)
    assert.strictEqual(front.name, BlackfinSkillName)
    assert.strictEqual(front.description, BlackfinSkillDescription)
  })

  it('puts each target at the right relative path', () => {
    const paths: Record<SkillTarget, string> = {
      [AgentId.ClaudeCode]: '.claude/skills/blackfin/SKILL.md',
      [AgentId.Codex]: '.codex/skills/blackfin/SKILL.md',
      [AgentId.Cursor]: '.cursor/rules/blackfin.mdc',
      [AgentId.Shared]: 'AGENTS.md',
    }
    for (const target of TARGETS) {
      const artifact = generateBlackfinSkill(doc(), target)
      assert.strictEqual(artifact.relativePath, paths[target])
    }
  })

  it('marks only the shared target as a delimited section, with both markers', () => {
    for (const target of TARGETS) {
      const artifact = generateBlackfinSkill(doc(), target)
      if (target === AgentId.Shared) {
        assert.ok(artifact.delimited !== null)
        assert.ok(artifact.body.startsWith(artifact.delimited.begin))
        assert.ok(artifact.body.trimEnd().endsWith(artifact.delimited.end))
        assert.ok(artifact.delimited.begin.includes('blackfin:begin'))
        assert.ok(artifact.delimited.end.includes('blackfin:end'))
      } else {
        assert.strictEqual(artifact.delimited, null)
      }
    }
  })

  it('keeps the embedded template byte-identical to the checked-in static file', () => {
    const onDisk = readFileSync(
      join(process.cwd(), 'app/static/skills/blackfin/SKILL.template.md'),
      'utf8'
    )
    assert.strictEqual(onDisk, BlackfinSkillTemplate)
  })

  it('rejects an unsupported agent at compile time', () => {
    // The generator's second parameter is SkillTarget; an unsupported agent
    // must not typecheck. Type-only — asTarget is never a real call site.
    const asTarget = (t: SkillTarget): SkillTarget => t
    // @ts-expect-error — Gemini is not a SkillTarget in v1.
    void asTarget(AgentId.Gemini)
  })
})

describe('classifyInstallState', () => {
  it('reports absent when nothing is on disk', () => {
    assert.deepStrictEqual(classifyInstallState(null, []), { kind: 'absent' })
  })

  it('reports current when the hash matches the latest known version', () => {
    const artifact = generateBlackfinSkill(doc(), AgentId.ClaudeCode)
    const known = [{ version: 1, hash: artifact.contentHash }]
    assert.deepStrictEqual(classifyInstallState(artifact.contentHash, known), {
      kind: 'current',
      version: 1,
    })
  })

  it('reports outdated when the hash matches an older known version', () => {
    const v1 = generateBlackfinSkill(doc(), AgentId.ClaudeCode)
    const known = [
      { version: 1, hash: v1.contentHash },
      { version: 2, hash: 'deadbeef-a-newer-version' },
    ]
    assert.deepStrictEqual(classifyInstallState(v1.contentHash, known), {
      kind: 'outdated',
      version: 1,
    })
  })

  it('reports modified-by-user when the hash matches nothing we wrote', () => {
    const known = [{ version: 1, hash: 'a-hash-we-wrote' }]
    assert.deepStrictEqual(
      classifyInstallState('the-user-edited-this', known),
      { kind: 'modified-by-user' }
    )
  })
})
