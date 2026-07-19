import { describe, it } from 'node:test'
import assert from 'node:assert'
import { ITask, TaskProviderId, TaskState } from '../../src/models/task'
import {
  proposeBranchNameForTask,
  MaxBranchSlugLength,
} from '../../src/lib/tasks/task-branch-name'
import {
  sanitizedRefName,
  testForInvalidChars,
} from '../../src/lib/sanitize-ref-name'

function sampleTask(overrides: Partial<ITask> = {}): ITask {
  return {
    providerId: TaskProviderId.GitHubIssues,
    externalId: '123',
    displayId: '#123',
    title: 'Fix the thing',
    state: TaskState.Todo,
    rawState: 'open',
    assignees: [],
    labels: [],
    url: 'https://github.com/o/r/issues/123',
    updatedAt: '2026-07-13T00:00:00Z',
    createdAt: '2026-07-01T00:00:00Z',
    gitHubRepositoryID: 7,
    ...overrides,
  }
}

// `testForInvalidChars` uses a global regex, whose `lastIndex` persists between
// calls; a fresh check here never depends on the previous one because
// `sanitizedRefName` (below) does not share that regex instance.
function isValidRef(name: string): boolean {
  // A valid ref is non-empty, has no edge hyphen, carries no illegal character,
  // and is left unchanged by the fork's own sanitizer — the real acceptance bar.
  return (
    !testForInvalidChars(name) &&
    name.length > 0 &&
    sanitizedRefName(name) === name &&
    !name.startsWith('-') &&
    !name.endsWith('-')
  )
}

describe('proposeBranchNameForTask', () => {
  it('is pure and deterministic', () => {
    const task = sampleTask({ title: 'Título com acento e / barra' })
    const a = proposeBranchNameForTask(task)
    const b = proposeBranchNameForTask(task)
    assert.deepStrictEqual(a, b)
  })

  it('produces the expected name for a plain title', () => {
    const result = proposeBranchNameForTask(
      sampleTask({ displayId: '#123', title: 'corrigir token expirado' })
    )
    assert.strictEqual(result.name, '123-corrigir-token-expirado')
    assert.strictEqual(result.deduped, false)
  })

  const hostileTitles: Array<{
    readonly name: string
    readonly title: string
  }> = [
    { name: 'shell metachars', title: '; rm -rf ~' },
    { name: 'git flag injection', title: '--upload-pack=/bin/sh' },
    { name: 'path traversal', title: '../../etc/passwd' },
    { name: 'double dot', title: '..' },
    { name: 'ref magic sequence', title: 'a@{b' },
    { name: 'double slash', title: 'a//b' },
    { name: 'over length', title: 'x'.repeat(200) },
    { name: 'only emoji', title: '\u{1F525}\u{1F525}\u{1F525}' },
    { name: 'unicode letters', title: 'Ångström café naïve' },
    { name: 'empty title', title: '' },
    { name: 'trailing dot lock', title: 'thing.lock' },
    { name: 'leading dot', title: '.hidden' },
    // A literal control char and a NUL, spelled as escapes so the source file
    // stays free of raw control bytes.
    { name: 'control char', title: 'a\u0001b' },
    { name: 'nul byte', title: 'a\u0000b' },
  ]

  for (const { name, title } of hostileTitles) {
    it(`produces a valid, harmless ref for ${name}`, () => {
      const { name: ref } = proposeBranchNameForTask(sampleTask({ title }))
      assert.ok(isValidRef(ref), `not a valid ref: ${JSON.stringify(ref)}`)
    })
  }

  it('never throws regardless of the title', () => {
    for (const { title } of hostileTitles) {
      assert.doesNotThrow(() => proposeBranchNameForTask(sampleTask({ title })))
    }
  })

  describe('presets', () => {
    it('prefixes with a preset that already ends in a slash', () => {
      const { name } = proposeBranchNameForTask(
        sampleTask({ displayId: '#7', title: 'add feature' }),
        { preset: { name: 'feature/', description: 'A feature' } }
      )
      assert.ok(name.startsWith('feature/'), name)
      assert.ok(isValidRef(name), name)
    })

    it('adds the slash to a preset that lacks one', () => {
      const { name } = proposeBranchNameForTask(
        sampleTask({ displayId: '#7', title: 'add feature' }),
        { preset: { name: 'bugfix', description: 'A bugfix' } }
      )
      assert.ok(name.startsWith('bugfix/'), name)
    })

    it('treats a null or whitespace preset as no prefix', () => {
      const base = proposeBranchNameForTask(sampleTask()).name
      assert.strictEqual(
        proposeBranchNameForTask(sampleTask(), { preset: null }).name,
        base
      )
      assert.strictEqual(
        proposeBranchNameForTask(sampleTask(), {
          preset: { name: '   ', description: '' },
        }).name,
        base
      )
    })

    it('survives a preset made only of illegal characters', () => {
      const { name } = proposeBranchNameForTask(sampleTask(), {
        preset: { name: '~^:?*', description: 'nonsense' },
      })
      assert.ok(isValidRef(name), name)
    })
  })

  describe('collision handling', () => {
    it('leaves a name untouched when nothing collides', () => {
      const result = proposeBranchNameForTask(
        sampleTask({ displayId: '#5', title: 'unique thing' }),
        { existingBranchNames: ['something-else'] }
      )
      assert.strictEqual(result.deduped, false)
      assert.strictEqual(result.name, '5-unique-thing')
    })

    it('appends a deterministic numeric suffix on collision', () => {
      const task = sampleTask({ displayId: '#5', title: 'dup' })
      const first = proposeBranchNameForTask(task).name
      const second = proposeBranchNameForTask(task, {
        existingBranchNames: [first],
      })
      assert.strictEqual(second.name, `${first}-2`)
      assert.strictEqual(second.deduped, true)

      const third = proposeBranchNameForTask(task, {
        existingBranchNames: [first, `${first}-2`],
      })
      assert.strictEqual(third.name, `${first}-3`)
    })

    it('is case-insensitive about existing names', () => {
      const task = sampleTask({ displayId: '#5', title: 'dup' })
      const first = proposeBranchNameForTask(task).name
      const result = proposeBranchNameForTask(task, {
        existingBranchNames: [first.toUpperCase()],
      })
      assert.strictEqual(result.deduped, true)
      assert.strictEqual(result.name, `${first}-2`)
    })
  })

  it('caps the slug length while keeping a valid ref', () => {
    const { name, slug } = proposeBranchNameForTask(
      sampleTask({ displayId: '#1', title: 'y'.repeat(300) })
    )
    // `slugifyTaskForBranch` caps at MaxBranchSlugLength; the prefix-less name
    // here is exactly the slug.
    assert.ok(
      slug.length <= MaxBranchSlugLength,
      `slug too long: ${slug.length}`
    )
    assert.strictEqual(name, slug)
    assert.ok(isValidRef(name), name)
  })
})
