import { describe, it } from 'node:test'
import assert from 'node:assert'
import { TaskProviderId } from '../../src/models/task'
import { ITaskProviderScopeMapping } from '../../src/models/task-provider'
import {
  ITaskProvider,
  ITaskProviderCapabilities,
  TaskProviderErrorCode,
  taskProviderError,
  taskProviderOk,
} from '../../src/lib/tasks/task-provider'
import {
  resolveProvidersForRepository,
  scopeMappingsForRepository,
  TaskProviderRegistry,
} from '../../src/lib/tasks/task-provider-registry'

const READ_ONLY_FORGE: ITaskProviderCapabilities = {
  canReadTasks: true,
  canWriteState: false,
  incrementalRefresh: true,
  providesScopes: true,
  usesGitAccount: true,
}

const WRITABLE_TRACKER: ITaskProviderCapabilities = {
  canReadTasks: true,
  canWriteState: true,
  incrementalRefresh: true,
  providesScopes: true,
  usesGitAccount: false,
}

// A minimal fake provider. Every method returns a benign result; the registry
// only ever reads `id`, `capabilities` and the presence of `setState`, so the
// bodies exist to satisfy the interface, not to be exercised here.
function fakeProvider(
  id: TaskProviderId,
  capabilities: ITaskProviderCapabilities,
  withSetState: boolean
): ITaskProvider {
  const provider: ITaskProvider = {
    id,
    capabilities,
    validate: async () =>
      taskProviderError(TaskProviderErrorCode.Unknown, 'not exercised'),
    listTasks: async () => taskProviderOk([]),
    getTask: async () =>
      taskProviderError(TaskProviderErrorCode.NotFound, 'not exercised'),
    listScopes: async () => taskProviderOk([]),
    listStates: async () => taskProviderOk([]),
  }
  if (withSetState) {
    return { ...provider, setState: async () => taskProviderOk(undefined) }
  }
  return provider
}

const gitHub = fakeProvider(TaskProviderId.GitHubIssues, READ_ONLY_FORGE, false)
const linear = fakeProvider(TaskProviderId.Linear, WRITABLE_TRACKER, true)

describe('TaskProviderRegistry lookup', () => {
  it('finds a registered provider by id', () => {
    const registry = new TaskProviderRegistry([gitHub, linear])
    assert.strictEqual(registry.get(TaskProviderId.GitHubIssues), gitHub)
    assert.strictEqual(registry.get(TaskProviderId.Linear), linear)
  })

  it('returns null for an unregistered id', () => {
    const registry = new TaskProviderRegistry([gitHub])
    assert.strictEqual(registry.get(TaskProviderId.Jira), null)
    assert.strictEqual(registry.has(TaskProviderId.Jira), false)
  })

  it('lists all providers in registration order', () => {
    const registry = new TaskProviderRegistry([gitHub, linear])
    assert.deepStrictEqual(
      registry.all().map(p => p.id),
      [TaskProviderId.GitHubIssues, TaskProviderId.Linear]
    )
  })

  it('rejects a duplicate id eagerly — a wiring bug, not a runtime condition', () => {
    const registry = new TaskProviderRegistry([gitHub])
    assert.throws(() => registry.register(gitHub), /already registered/)
  })
})

describe('TaskProviderRegistry capability queries', () => {
  const registry = new TaskProviderRegistry([gitHub, linear])

  it('writable returns only providers that can genuinely write', () => {
    assert.deepStrictEqual(
      registry.writable().map(p => p.id),
      [TaskProviderId.Linear]
    )
  })

  it('forgeProviders returns only those using the git account', () => {
    assert.deepStrictEqual(
      registry.forgeProviders().map(p => p.id),
      [TaskProviderId.GitHubIssues]
    )
  })

  it('a provider claiming write but missing setState is not treated as writable', () => {
    // Capability and method must agree; a mismatch is treated as read-only
    // rather than crashing at the call site.
    const liar = fakeProvider(TaskProviderId.Jira, WRITABLE_TRACKER, false)
    const withLiar = new TaskProviderRegistry([liar])
    assert.deepStrictEqual(withLiar.writable(), [])
  })

  it('withCapability filters by an arbitrary predicate', () => {
    assert.deepStrictEqual(
      registry
        .withCapability(p => p.capabilities.incrementalRefresh)
        .map(p => p.id),
      [TaskProviderId.GitHubIssues, TaskProviderId.Linear]
    )
  })
})

describe('scopeMappingsForRepository', () => {
  const mappings: ReadonlyArray<ITaskProviderScopeMapping> = [
    {
      repositoryId: 1,
      providerId: TaskProviderId.Linear,
      scopeId: 'ENG',
      scopeDisplayName: 'Engineering',
    },
    {
      repositoryId: 2,
      providerId: TaskProviderId.Linear,
      scopeId: 'OPS',
      scopeDisplayName: 'Operations',
    },
  ]

  it('returns only the mappings for the given repository', () => {
    const forOne = scopeMappingsForRepository(mappings, 1)
    assert.strictEqual(forOne.length, 1)
    assert.strictEqual(forOne[0].scopeId, 'ENG')
  })

  it('returns empty for a repository with no mapping', () => {
    assert.deepStrictEqual(scopeMappingsForRepository(mappings, 99), [])
  })
})

describe('resolveProvidersForRepository', () => {
  const registry = new TaskProviderRegistry([gitHub, linear])

  it('resolves a forge provider with a null scope, everywhere', () => {
    const resolved = resolveProvidersForRepository(registry, [], 1)
    assert.deepStrictEqual(
      resolved.map(r => [r.provider.id, r.scopeId]),
      [[TaskProviderId.GitHubIssues, null]]
    )
  })

  it('resolves a non-forge provider only where it is explicitly mapped, with that scope', () => {
    const mappings: ReadonlyArray<ITaskProviderScopeMapping> = [
      {
        repositoryId: 1,
        providerId: TaskProviderId.Linear,
        scopeId: 'ENG',
        scopeDisplayName: 'Engineering',
      },
    ]
    const resolved = resolveProvidersForRepository(registry, mappings, 1)
    assert.deepStrictEqual(
      resolved.map(r => [r.provider.id, r.scopeId]),
      [
        [TaskProviderId.GitHubIssues, null],
        [TaskProviderId.Linear, 'ENG'],
      ]
    )
  })

  it('never guesses: an unmapped repo yields only the forge, never the Linear provider', () => {
    const mappings: ReadonlyArray<ITaskProviderScopeMapping> = [
      {
        repositoryId: 1,
        providerId: TaskProviderId.Linear,
        scopeId: 'ENG',
        scopeDisplayName: 'Engineering',
      },
    ]
    // Repository 2 has no mapping for Linear — it must not be inferred.
    const resolved = resolveProvidersForRepository(registry, mappings, 2)
    assert.deepStrictEqual(
      resolved.map(r => r.provider.id),
      [TaskProviderId.GitHubIssues]
    )
  })

  it('resolves to empty when no forge is registered and nothing is mapped', () => {
    const onlyLinear = new TaskProviderRegistry([linear])
    assert.deepStrictEqual(resolveProvidersForRepository(onlyLinear, [], 1), [])
  })

  it('skips a mapping whose provider is not registered rather than fabricating one', () => {
    const onlyGitHub = new TaskProviderRegistry([gitHub])
    const mappings: ReadonlyArray<ITaskProviderScopeMapping> = [
      {
        repositoryId: 1,
        providerId: TaskProviderId.Linear,
        scopeId: 'ENG',
        scopeDisplayName: 'Engineering',
      },
    ]
    const resolved = resolveProvidersForRepository(onlyGitHub, mappings, 1)
    assert.deepStrictEqual(
      resolved.map(r => r.provider.id),
      [TaskProviderId.GitHubIssues]
    )
  })
})
