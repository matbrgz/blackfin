import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AgentId,
  ContextRole,
  ContextScope,
  IContextFile,
  IContextReference,
} from '../../src/models/workspace-inventory'
import {
  buildEffectiveContext,
  buildProjectInfo,
  buildWorktreeInfo,
  capPageByBytes,
  filterContextEntries,
  GlobalContextNote,
  ICLIContextEntry,
  ICLIEntryContext,
  IEffectiveContextInput,
  listExtensions,
  MaxResponseBytes,
  NotInRepositoryWarning,
  paginate,
  toCLIContextDetail,
  toCLIContextEntry,
} from '../../src/lib/cli/commands/read'
import { allCommands } from '../../src/lib/cli/registry'
import { ICwdRepository } from '../../src/lib/cli/resolve-cwd'

const ENTRY_CONTEXT: ICLIEntryContext = {
  repositoryId: 7,
  homePath: '/Users/x',
}

function ref(raw: string, target: string, exists: boolean): IContextReference {
  return { raw, target, exists }
}

function file(overrides: Partial<IContextFile> = {}): IContextFile {
  return {
    agent: AgentId.ClaudeCode,
    role: ContextRole.Instructions,
    scope: ContextScope.Project,
    relativePath: 'CLAUDE.md',
    byteLength: 100,
    lineCount: 10,
    modifiedAt: 1_700_000_000_000,
    name: null,
    description: null,
    headings: [],
    ruleCount: 0,
    references: [],
    skippedReason: null,
    ...overrides,
  }
}

function projectFile(overrides: Partial<IContextFile> = {}): IContextFile {
  return file({ scope: ContextScope.Project, ...overrides })
}

function globalFile(overrides: Partial<IContextFile> = {}): IContextFile {
  return file({
    scope: ContextScope.Global,
    relativePath: '.claude/CLAUDE.md',
    ...overrides,
  })
}

function effectiveInput(
  overrides: Partial<IEffectiveContextInput> = {}
): IEffectiveContextInput {
  return {
    cwd: '/Users/x/proj',
    repository: { id: 7, name: 'proj', gitDir: '/Users/x/proj/.git' },
    worktree: {
      path: '/Users/x/proj',
      branch: 'refs/heads/main',
      isPrimary: true,
    },
    repositoryId: 7,
    homePath: '/Users/x',
    projectFiles: [],
    globalFiles: [],
    ...overrides,
  }
}

describe('buildEffectiveContext', () => {
  it('returns all project and global entries, with the globals first and noted', () => {
    const input = effectiveInput({
      projectFiles: [
        projectFile({ relativePath: 'CLAUDE.md', ruleCount: 12 }),
        projectFile({
          relativePath: '.claude/skills/review/SKILL.md',
          role: ContextRole.Skill,
          name: 'review',
        }),
      ],
      globalFiles: [
        globalFile({ relativePath: '.claude/CLAUDE.md', ruleCount: 9 }),
        globalFile({
          relativePath: '.claude/settings.json',
          role: ContextRole.Settings,
        }),
        globalFile({ relativePath: '.codex/AGENTS.md', agent: AgentId.Codex }),
      ],
    })

    const result = buildEffectiveContext(input)

    assert.strictEqual(result.entries.length, 5)
    // Globals first — they are the invisible half.
    assert.deepStrictEqual(
      result.entries.slice(0, 3).map(e => e.scope),
      ['global', 'global', 'global']
    )
    assert.deepStrictEqual(
      result.entries.slice(3).map(e => e.scope),
      ['project', 'project']
    )
    // Every global entry carries the note; no project entry does.
    for (const entry of result.entries.filter(e => e.scope === 'global')) {
      assert.strictEqual(entry.note, GlobalContextNote)
    }
    for (const entry of result.entries.filter(e => e.scope === 'project')) {
      assert.strictEqual(entry.note, undefined)
    }
    assert.deepStrictEqual(result.summary, {
      project: 2,
      global: 3,
      brokenReferences: 0,
    })
  })

  it('turns one broken global reference into exactly one warning naming file and target', () => {
    const input = effectiveInput({
      globalFiles: [
        globalFile({
          relativePath: '.claude/CLAUDE.md',
          references: [
            ref('@import ./house-style.md', './house-style.md', false),
          ],
        }),
      ],
    })

    const result = buildEffectiveContext(input)

    assert.strictEqual(result.summary.brokenReferences, 1)
    const brokenWarnings = result.warnings.filter(w =>
      w.startsWith('Broken reference')
    )
    assert.strictEqual(brokenWarnings.length, 1)
    // Names the file (with ~/ prefix) and the missing target.
    assert.match(brokenWarnings[0], /~\/\.claude\/CLAUDE\.md/)
    assert.match(brokenWarnings[0], /\.\/house-style\.md/)
  })

  it('outside a known repository, reports only global context and does not error', () => {
    const input = effectiveInput({
      cwd: '/tmp/x',
      repository: null,
      worktree: null,
      repositoryId: null,
      projectFiles: [],
      globalFiles: [globalFile({ relativePath: '.claude/CLAUDE.md' })],
    })

    const result = buildEffectiveContext(input)

    assert.strictEqual(result.repository, null)
    assert.strictEqual(result.entries.length, 1)
    assert.strictEqual(result.entries[0].scope, 'global')
    assert.ok(result.warnings.includes(NotInRepositoryWarning))
  })
})

describe('toCLIContextEntry — the redaction choke point', () => {
  it('never emits headings or the file body', () => {
    // A file whose headings carry distinctive text.
    const marker = 'DISTINCTIVE_HEADING_TEXT_9f3a'
    const entry = toCLIContextEntry(
      projectFile({
        headings: [{ level: 1, text: marker }],
      }),
      ENTRY_CONTEXT
    )
    const json = JSON.stringify(entry)
    assert.doesNotMatch(json, new RegExp(marker))
    assert.ok(!('headings' in entry), 'entry must not carry a headings field')
  })

  it('never leaks a secret from a settings file', () => {
    // A synthetic token, as would appear in the *content* of settings.json.
    const token = 'sk-live-0123456789abcdef0123456789abcdef'
    const entry = toCLIContextEntry(
      globalFile({
        relativePath: '.claude/settings.json',
        role: ContextRole.Settings,
        // The token could only have reached a naive projection via headings or
        // a copied body; the choke point copies neither.
        headings: [{ level: 1, text: token }],
      }),
      ENTRY_CONTEXT
    )
    assert.doesNotMatch(JSON.stringify(entry), new RegExp(token))
  })

  it('builds a stable id and a ~/-prefixed path for a global entry', () => {
    const entry = toCLIContextEntry(
      globalFile({ relativePath: '.claude/CLAUDE.md' }),
      ENTRY_CONTEXT
    )
    assert.strictEqual(entry.id, 'global:.claude/CLAUDE.md')
    assert.strictEqual(entry.path, '~/.claude/CLAUDE.md')
    assert.strictEqual(entry.scope, 'global')
  })

  it('builds a repo-scoped id for a project entry', () => {
    const entry = toCLIContextEntry(
      projectFile({ relativePath: 'CLAUDE.md' }),
      ENTRY_CONTEXT
    )
    assert.strictEqual(entry.id, 'repo:7:CLAUDE.md')
    assert.strictEqual(entry.path, 'CLAUDE.md')
  })
})

describe('toCLIContextDetail', () => {
  it('carries the structural map — headings and references — but no body', () => {
    const detail = toCLIContextDetail(
      projectFile({
        headings: [{ level: 1, text: 'Setup' }],
        references: [
          ref('@import ./a.md', './a.md', true),
          ref('@import ./b.md', './b.md', false),
        ],
      }),
      ENTRY_CONTEXT
    )
    assert.strictEqual(detail.headings.length, 1)
    assert.strictEqual(detail.references.length, 2)
    assert.strictEqual(detail.brokenReferences.length, 1)
    assert.strictEqual(detail.brokenReferences[0].target, './b.md')
  })
})

describe('filterContextEntries and listExtensions', () => {
  function sampleEntries(): ReadonlyArray<ICLIContextEntry> {
    return [
      toCLIContextEntry(
        projectFile({
          relativePath: 'CLAUDE.md',
          role: ContextRole.Instructions,
        }),
        ENTRY_CONTEXT
      ),
      toCLIContextEntry(
        projectFile({
          relativePath: '.claude/skills/review/SKILL.md',
          role: ContextRole.Skill,
          name: 'review',
        }),
        ENTRY_CONTEXT
      ),
      toCLIContextEntry(
        projectFile({
          relativePath: '.codex/skills/build/SKILL.md',
          role: ContextRole.Skill,
          agent: AgentId.Codex,
          name: 'build',
        }),
        ENTRY_CONTEXT
      ),
    ]
  }

  it('filters by agent and kind as an intersection, delegating no logic', () => {
    const entries = sampleEntries()
    const both = filterContextEntries(entries, {
      agent: 'claude-code',
      kind: 'skill',
    })
    const byAgent = filterContextEntries(entries, { agent: 'claude-code' })
    const byKind = filterContextEntries(entries, { kind: 'skill' })
    const intersection = byAgent.filter(a => byKind.some(b => b.id === a.id))
    assert.deepStrictEqual(
      both.map(e => e.id),
      intersection.map(e => e.id)
    )
    assert.strictEqual(both.length, 1)
    assert.strictEqual(both[0].name, 'review')
  })

  it('extension list agrees with the same projection the Agents screen uses', () => {
    // Both derive from the same entries and the same skill filter, so they can
    // never disagree.
    const entries = sampleEntries()
    const viaExtensionList = listExtensions(entries, { kind: 'skill' })
    const viaScreenProjection = entries.filter(e => e.kind === 'skill')
    assert.deepStrictEqual(
      viaExtensionList.map(e => e.id),
      viaScreenProjection.map(e => e.id)
    )
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 250 }, (_, index) => ({ index }))

  it('reports the un-paginated total and pages stably', () => {
    const page = paginate(items, 100, 0)
    assert.strictEqual(page.total, 250)
    assert.strictEqual(page.items.length, 100)
    assert.strictEqual(page.truncated, true)
    assert.strictEqual(page.items[0].index, 0)

    const second = paginate(items, 100, 100)
    assert.strictEqual(second.items[0].index, 100)
    assert.strictEqual(second.total, 250)
    assert.strictEqual(second.truncated, true)
  })

  it('does not mark the last page truncated', () => {
    const page = paginate(items, 100, 200)
    assert.strictEqual(page.items.length, 50)
    assert.strictEqual(page.truncated, false)
  })

  it('yields an empty window past the end without throwing', () => {
    const page = paginate(items, 100, 10_000)
    assert.strictEqual(page.items.length, 0)
    assert.strictEqual(page.total, 250)
  })
})

describe('capPageByBytes', () => {
  it('truncates an oversized page to a parseable prefix and declares it', () => {
    const bulky = 'x'.repeat(1024)
    const items = Array.from({ length: 1000 }, (_, index) => ({
      index,
      blob: bulky,
    }))
    const page = paginate(items, 1000, 0)
    const capped = capPageByBytes(page, MaxResponseBytes)

    assert.strictEqual(capped.truncated, true)
    assert.ok(capped.items.length < items.length)
    // The serialized items array is still valid JSON.
    const roundTrip = JSON.parse(JSON.stringify(capped.items))
    assert.ok(Array.isArray(roundTrip))
    assert.ok(
      Buffer.byteLength(JSON.stringify(capped.items), 'utf8') <=
        MaxResponseBytes
    )
  })

  it('leaves a page that fits untouched', () => {
    const page = paginate([{ a: 1 }, { a: 2 }], 100, 0)
    const capped = capPageByBytes(page, MaxResponseBytes)
    assert.strictEqual(capped, page)
    assert.strictEqual(capped.truncated, false)
  })
})

describe('buildProjectInfo and buildWorktreeInfo', () => {
  const repository: ICwdRepository = {
    name: 'proj',
    commonGitDir: '/Users/x/proj/.git',
    worktrees: [
      { path: '/Users/x/proj', branch: 'refs/heads/main', isMain: true },
      {
        path: '/Users/x/proj-wt/auth',
        branch: 'refs/heads/feat/auth',
        isMain: false,
      },
    ],
  }

  it('reports the project, its worktrees, and context health', () => {
    const info = buildProjectInfo(repository, repository.worktrees[0], 7, [
      projectFile({
        references: [ref('@import ./missing.md', './missing.md', false)],
      }),
    ])
    assert.strictEqual(info.id, 7)
    assert.strictEqual(info.name, 'proj')
    assert.strictEqual(info.gitDir, '/Users/x/proj/.git')
    assert.strictEqual(info.branch, 'refs/heads/main')
    assert.strictEqual(info.worktrees.length, 2)
    assert.strictEqual(info.worktrees[0].isPrimary, true)
    assert.deepStrictEqual(info.contextHealth, {
      contextFiles: 1,
      brokenReferences: 1,
    })
  })

  it('degrades worktree info gracefully until lineage exists (#55)', () => {
    const info = buildWorktreeInfo(repository, repository.worktrees[1])
    assert.strictEqual(info.path, '/Users/x/proj-wt/auth')
    assert.strictEqual(info.branch, 'refs/heads/feat/auth')
    assert.strictEqual(info.gitDir, '/Users/x/proj/.git')
    assert.strictEqual(info.isPrimary, false)
    assert.strictEqual(info.base, null)
    assert.deepStrictEqual(info.lineage, [])
    assert.strictEqual(info.checkpoint, null)
  })
})

describe('the six read commands are registered read-only (#63 in the #62 schema)', () => {
  const READ_COMMANDS = [
    'context effective',
    'context list',
    'context show',
    'extension list',
    'project info',
    'worktree info',
  ]

  it('registers all six, each mutating nothing and reading Blackfin state', () => {
    const byName = new Map(allCommands().map(c => [c.name, c]))
    for (const name of READ_COMMANDS) {
      const command = byName.get(name)
      assert.ok(command !== undefined, `${name} must be registered`)
      assert.strictEqual(command!.mutates, false, `${name} must not mutate`)
      assert.strictEqual(command!.requiresApp, true, `${name} needs the app`)
      assert.ok(
        command!.effects.includes('reads-blackfin-state'),
        `${name} must read Blackfin state`
      )
    }
  })
})
