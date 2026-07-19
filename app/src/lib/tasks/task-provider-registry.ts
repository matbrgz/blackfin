import { TaskProviderId } from '../../models/task'
import { ITaskProviderScopeMapping } from '../../models/task-provider'
import { ITaskProvider, providerCanWriteState } from './task-provider'

// A pure registry and lookup for task providers (#75).
//
// No I/O, no store, no network: the registry is an in-memory index of the
// providers a running app has wired up, plus the pure resolution rules that turn
// "which providers apply to this repository" into an answer. It is the seam a
// UI/store layer consults — "which providers can write?", "which apply here?" —
// without any of them re-implementing the traversal.
//
// The resolution rules encode the #75 principle directly: a forge provider
// (`usesGitAccount`) applies to a repository because the repository carries its
// account; a non-forge provider applies ONLY where the user has explicitly mapped
// it. There is no name heuristic and no URL sniffing — an unmapped repo yields an
// empty list, never a guess.

/**
 * An in-memory index of providers, keyed by id. Pure — constructing one and
 * querying it touches nothing outside the object.
 */
export class TaskProviderRegistry {
  private readonly providers = new Map<TaskProviderId, ITaskProvider>()

  /**
   * Build a registry from an initial set of providers. Registering two providers
   * with the same id is a wiring bug, not a runtime condition, so it throws here
   * at construction rather than silently letting one shadow the other.
   */
  public constructor(providers: ReadonlyArray<ITaskProvider> = []) {
    for (const provider of providers) {
      this.register(provider)
    }
  }

  /**
   * Add a provider. Throws on a duplicate id — a configuration error surfaced
   * eagerly, distinct from the never-throwing I/O boundary of a provider itself.
   */
  public register(provider: ITaskProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `A task provider is already registered for id '${provider.id}'.`
      )
    }
    this.providers.set(provider.id, provider)
  }

  /** The provider for an id, or null when none is registered. */
  public get(id: TaskProviderId): ITaskProvider | null {
    return this.providers.get(id) ?? null
  }

  /** Whether a provider is registered for an id. */
  public has(id: TaskProviderId): boolean {
    return this.providers.has(id)
  }

  /** Every registered provider, in registration order. */
  public all(): ReadonlyArray<ITaskProvider> {
    return Array.from(this.providers.values())
  }

  /** The providers for which a capability predicate holds. */
  public withCapability(
    predicate: (provider: ITaskProvider) => boolean
  ): ReadonlyArray<ITaskProvider> {
    return this.all().filter(predicate)
  }

  /** The providers that can genuinely write a task's state back (#79). */
  public writable(): ReadonlyArray<ITaskProvider> {
    return this.withCapability(providerCanWriteState)
  }

  /** The providers that authenticate with the user's existing git account. */
  public forgeProviders(): ReadonlyArray<ITaskProvider> {
    return this.withCapability(p => p.capabilities.usesGitAccount)
  }
}

/** A provider resolved for a repository, paired with the scope it should query. */
export interface IResolvedTaskProvider {
  readonly provider: ITaskProvider
  /**
   * The scope to query, or null for a forge that locates work by the repository
   * itself rather than a mapped scope.
   */
  readonly scopeId: string | null
}

/** The scope mappings that apply to a repository. A pure filter. */
export function scopeMappingsForRepository(
  mappings: ReadonlyArray<ITaskProviderScopeMapping>,
  repositoryId: number
): ReadonlyArray<ITaskProviderScopeMapping> {
  return mappings.filter(m => m.repositoryId === repositoryId)
}

/**
 * The providers that apply to a repository, resolved from the registry and the
 * explicit scope mappings — the pure heart of what #75 calls
 * `resolveProvidersForRepository`.
 *
 * The rule, and nothing more:
 *
 *   - a forge provider (`usesGitAccount`) applies, with a null scope, because the
 *     repository carries its own account;
 *   - a non-forge provider applies ONLY when the user has explicitly mapped this
 *     repository to one of its scopes, and then with that scope.
 *
 * A mapping whose provider is not registered is skipped rather than fabricated,
 * and a repository with neither a forge provider nor a mapping resolves to `[]` —
 * the honest "nothing is mapped here", never a guess from a name or a URL.
 */
export function resolveProvidersForRepository(
  registry: TaskProviderRegistry,
  mappings: ReadonlyArray<ITaskProviderScopeMapping>,
  repositoryId: number
): ReadonlyArray<IResolvedTaskProvider> {
  const resolved = new Array<IResolvedTaskProvider>()

  // Forge providers apply everywhere the git account does, with no mapped scope.
  for (const provider of registry.forgeProviders()) {
    resolved.push({ provider, scopeId: null })
  }

  // Non-forge providers apply only where an explicit mapping exists.
  for (const mapping of scopeMappingsForRepository(mappings, repositoryId)) {
    const provider = registry.get(mapping.providerId)
    if (provider === null || provider.capabilities.usesGitAccount) {
      // Unregistered, or already covered as a forge above — never invented.
      continue
    }
    resolved.push({ provider, scopeId: mapping.scopeId })
  }

  return resolved
}
