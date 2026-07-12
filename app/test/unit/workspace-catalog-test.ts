import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  classifyArtifact,
  classifyContext,
  isDoc,
  isNeverWalked,
} from '../../src/lib/workspace/catalog'
import {
  AgentId,
  ArtifactKind,
  ContextRole,
} from '../../src/models/workspace-inventory'

const noSiblings = () => false
const hasSibling = (want: string) => (name: string) => name === want

describe('classifyContext', () => {
  it('recognises standing instructions for each agent', () => {
    assert.deepEqual(classifyContext('CLAUDE.md'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Instructions,
    })
    assert.deepEqual(classifyContext('GEMINI.md'), {
      agent: AgentId.Gemini,
      role: ContextRole.Instructions,
    })
    assert.deepEqual(classifyContext('.cursorrules'), {
      agent: AgentId.Cursor,
      role: ContextRole.Instructions,
    })
    assert.deepEqual(classifyContext('.windsurfrules'), {
      agent: AgentId.Windsurf,
      role: ContextRole.Instructions,
    })
  })

  it('attributes AGENTS.md to no single agent', () => {
    // Codex, OpenCode, Amp and Antigravity all read it. Crediting it to any one
    // of them would be a lie the UI then repeats.
    assert.deepEqual(classifyContext('AGENTS.md'), {
      agent: AgentId.Shared,
      role: ContextRole.Instructions,
    })
  })

  it('finds instruction files nested in a monorepo', () => {
    assert.deepEqual(classifyContext('packages/api/CLAUDE.md'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Instructions,
    })
  })

  it('recognises skills by their manifest, and attributes them to the owning agent', () => {
    assert.deepEqual(classifyContext('.claude/skills/deploy/SKILL.md'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Skill,
    })
    assert.deepEqual(classifyContext('.opencode/skills/lint/SKILL.md'), {
      agent: AgentId.OpenCode,
      role: ContextRole.Skill,
    })
  })

  it('treats a bare skills/ directory as shared', () => {
    // The convention `npx skills add` and Orca both use.
    assert.deepEqual(classifyContext('skills/orca-cli/SKILL.md'), {
      agent: AgentId.Shared,
      role: ContextRole.Skill,
    })
  })

  it('distinguishes commands, subagents and prompts', () => {
    assert.deepEqual(classifyContext('.claude/commands/review.md'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Command,
    })
    assert.deepEqual(classifyContext('.claude/agents/explorer.md'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Subagent,
    })
    assert.deepEqual(classifyContext('.codex/prompts/refactor.md'), {
      agent: AgentId.Codex,
      role: ContextRole.Prompt,
    })
  })

  it('recognises settings files', () => {
    assert.deepEqual(classifyContext('.claude/settings.json'), {
      agent: AgentId.ClaudeCode,
      role: ContextRole.Settings,
    })
    assert.deepEqual(classifyContext('.codex/config.toml'), {
      agent: AgentId.Codex,
      role: ContextRole.Settings,
    })
  })

  it('recognises cursor rules, which use their own extension', () => {
    assert.deepEqual(classifyContext('.cursor/rules/style.mdc'), {
      agent: AgentId.Cursor,
      role: ContextRole.Instructions,
    })
  })

  it('handles copilot, which lives under .github rather than a home of its own', () => {
    assert.deepEqual(classifyContext('.github/copilot-instructions.md'), {
      agent: AgentId.Copilot,
      role: ContextRole.Instructions,
    })
    assert.deepEqual(classifyContext('.github/instructions/api.instructions.md'), {
      agent: AgentId.Copilot,
      role: ContextRole.Instructions,
    })
    assert.deepEqual(classifyContext('.github/prompts/fix.prompt.md'), {
      agent: AgentId.Copilot,
      role: ContextRole.Prompt,
    })
  })

  it('does not claim unrelated files under .github', () => {
    assert.equal(classifyContext('.github/workflows/ci.yml'), null)
    assert.equal(classifyContext('.github/PULL_REQUEST_TEMPLATE.md'), null)
  })

  it('returns null for ordinary source and docs', () => {
    assert.equal(classifyContext('src/index.ts'), null)
    assert.equal(classifyContext('README.md'), null)
    assert.equal(classifyContext('docs/architecture.md'), null)
  })
})

describe('classifyArtifact', () => {
  it('recognises dependency directories unconditionally', () => {
    assert.equal(
      classifyArtifact('node_modules', noSiblings),
      ArtifactKind.Dependencies
    )
    assert.equal(classifyArtifact('Pods', noSiblings), ArtifactKind.Dependencies)
  })

  it('recognises caches and virtual environments', () => {
    assert.equal(classifyArtifact('__pycache__', noSiblings), ArtifactKind.Cache)
    assert.equal(classifyArtifact('.turbo', noSiblings), ArtifactKind.Cache)
    assert.equal(classifyArtifact('.venv', noSiblings), ArtifactKind.VirtualEnv)
    assert.equal(classifyArtifact('coverage', noSiblings), ArtifactKind.Coverage)
  })

  it('only calls dist build output when a manifest says a build tool owns it', () => {
    // This is the guard that stops us offering to delete someone's hand-written
    // dist/ directory. Getting it wrong is not a recoverable mistake.
    assert.equal(classifyArtifact('dist', noSiblings), null)
    assert.equal(
      classifyArtifact('dist', hasSibling('package.json')),
      ArtifactKind.BuildOutput
    )
  })

  it('requires Cargo.toml before calling target build output', () => {
    assert.equal(classifyArtifact('target', noSiblings), null)
    assert.equal(
      classifyArtifact('target', hasSibling('Cargo.toml')),
      ArtifactKind.BuildOutput
    )
  })

  it('recognises framework output directories unconditionally', () => {
    // .next is never anything but build output.
    assert.equal(classifyArtifact('.next', noSiblings), ArtifactKind.BuildOutput)
  })

  it('returns null for ordinary directories', () => {
    assert.equal(classifyArtifact('src', noSiblings), null)
    assert.equal(classifyArtifact('app', hasSibling('package.json')), null)
  })
})

describe('isNeverWalked', () => {
  it('skips the git directory', () => {
    assert.equal(isNeverWalked('.git'), true)
  })

  it('does not skip node_modules, which we measure rather than ignore', () => {
    assert.equal(isNeverWalked('node_modules'), false)
  })
})

describe('isDoc', () => {
  it('counts root markdown and anything under a docs directory', () => {
    assert.equal(isDoc('README.md'), true)
    assert.equal(isDoc('CONTRIBUTING.md'), true)
    assert.equal(isDoc('docs/architecture.md'), true)
    assert.equal(isDoc('docs/adr/0001-use-postgres.md'), true)
    assert.equal(isDoc('documentation/setup.mdx'), true)
  })

  it('does not count markdown buried in source directories', () => {
    assert.equal(isDoc('src/components/notes.md'), false)
  })

  it('does not count non-markdown', () => {
    assert.equal(isDoc('docs/diagram.png'), false)
  })
})
