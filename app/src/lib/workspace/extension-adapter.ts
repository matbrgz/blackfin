// The bridge between what the scanners see and what the extension model says
// (#21). It is deliberately one-directional: `IRepositoryInventory` and
// `IGlobalContext` go in, `IDetectedCapability` comes out, and the scanners do
// not know this module exists. That separation is the point — `scan.ts`,
// `scan-global.ts` and `catalog.ts` keep producing the raw observation of disk,
// and nothing in the extension model can reach back and change what they see.
//
// Pure, no I/O, never throws. Every fact it cannot derive from the inventory is
// an *input*, never an invention: see `IDetectionInputs`.

import {
  IContextFile,
  IGlobalContext,
  IRepositoryInventory,
} from '../../models/workspace-inventory'
import {
  CapabilityKind,
  IDetectedCapability,
  capabilityKindForRole,
  capabilityScopeFromContextScope,
  logicalNameFor,
} from '../../models/extension'

/**
 * The content hash of a capability whose bytes nobody has read.
 *
 * The shipped inventory does not carry a hash: `IContextFile` records
 * `byteLength`, `lineCount` and `modifiedAt`, and the scanner never keeps the
 * content it parsed. So the adapter cannot produce one, and it will not fake
 * one — a fabricated hash would silently mean "hand-edited" for every installed
 * item the moment a record existed.
 *
 * The sentinel is a value with no possible collision (a real hash is hex) and
 * one defined meaning: *we have not looked*. `reconcile()` treats it as "cannot
 * tell" rather than as a mismatch.
 */
export const UnknownContentHash = ''

/**
 * The facts about a capability that the shipped inventory genuinely does not
 * contain. Each one is supplied by the caller — who may know it — instead of
 * being guessed here.
 *
 * Both are optional, and both default to ignorance. Omitting `contentHashOf`
 * costs edit detection (`locallyModified` stays false, which is the honest
 * answer when the bytes were never read). Omitting `disabledPaths` means no
 * item is reported as disabled, which is the state of the world until a scanner
 * can observe disable edits (#40, #43).
 */
export interface IDetectionInputs {
  /** Current content hash for a path, or null when it has not been computed. */
  readonly contentHashOf?: (relativePath: string) => string | null
  /** Paths the caller has established are disabled in the agent's own config. */
  readonly disabledPaths?: ReadonlySet<string>
}

/**
 * Project one scanned context file into the extension model, or `null` when it
 * is not a capability at all.
 *
 * `null` happens for exactly one role today — `Settings` — and that is not a
 * gap. A settings file is a *container* that declares mcp-server capabilities;
 * turning it into one catalog row would put `mcp.json` in the list instead of
 * the five servers inside it. Extracting those servers requires opening the
 * file, which is I/O, which is #43.
 */
function detectedCapabilityFor(
  file: IContextFile,
  inputs: IDetectionInputs
): IDetectedCapability | null {
  const kind = capabilityKindForRole(file.role)
  if (kind === null) {
    return null
  }

  const contentHash = inputs.contentHashOf?.(file.relativePath) ?? null

  return {
    kind,
    scope: capabilityScopeFromContextScope(file.scope),
    // One scanned file is read by one agent. `AgentId.Shared` is already the
    // name for "the AGENTS.md convention, which several agents read" — it is
    // not expanded into its readers here, because the inventory does not know
    // which of them are installed, and listing agents that are not would be a
    // claim about this machine that nobody verified.
    agents: [file.agent],
    relativePath: file.relativePath,
    logicalName: logicalNameFor(kind, file.relativePath, file.name),
    description: file.description,
    contentHash: contentHash ?? UnknownContentHash,
    modifiedAt: file.modifiedAt,
    // Carried through unchanged: a reference that does not resolve is what
    // makes a capability `broken`, and the scanner already resolved it.
    references: file.references,
    disabled: inputs.disabledPaths?.has(file.relativePath) ?? false,
    // The shipped parser reads `name` and `description` and stops
    // (`parse.ts` — "This is not a YAML parser and does not pretend to be").
    // A manifest is therefore never available from an inventory, and absence
    // is the common case anyway (RFC #11 §5.5).
    manifest: null,
    // Never reachable from a `ContextRole`: `Settings` maps to null above, so
    // no inventory row can produce `mcp-server`. MCP capabilities enter through
    // settings extraction (#43), not through this adapter.
    mcp: null,
  }
}

/**
 * Every capability a repository inventory contains, in scan order.
 *
 * Rows that are not capabilities are dropped rather than represented as empty
 * ones — an inventory of eight files that yields six capabilities is the
 * correct answer, not a bug.
 */
export function detectedCapabilitiesForInventory(
  inventory: IRepositoryInventory,
  inputs: IDetectionInputs = {}
): ReadonlyArray<IDetectedCapability> {
  return collect(inventory.contextFiles, inputs)
}

/**
 * Every capability in the user's home directory — the ones that steer every
 * project on this machine, and are invisible from inside any of them.
 */
export function detectedCapabilitiesForGlobalContext(
  context: IGlobalContext,
  inputs: IDetectionInputs = {}
): ReadonlyArray<IDetectedCapability> {
  return collect(context.contextFiles, inputs)
}

function collect(
  files: ReadonlyArray<IContextFile>,
  inputs: IDetectionInputs
): ReadonlyArray<IDetectedCapability> {
  const capabilities: Array<IDetectedCapability> = []
  for (const file of files) {
    const capability = detectedCapabilityFor(file, inputs)
    if (capability !== null) {
      capabilities.push(capability)
    }
  }
  return capabilities
}

/**
 * The whole picture: global context first, then every repository.
 *
 * Order matters to the reader, not to correctness — global items come first
 * because they are the ones that reach furthest, and `reconcile()` computes the
 * inherited/overridden relation over exactly this kind of mixed-scope list.
 */
export function detectedCapabilitiesAcross(
  globalContext: IGlobalContext | null,
  inventories: ReadonlyArray<IRepositoryInventory>,
  inputs: IDetectionInputs = {}
): ReadonlyArray<IDetectedCapability> {
  const capabilities: Array<IDetectedCapability> = []
  if (globalContext !== null) {
    capabilities.push(
      ...detectedCapabilitiesForGlobalContext(globalContext, inputs)
    )
  }
  for (const inventory of inventories) {
    capabilities.push(...detectedCapabilitiesForInventory(inventory, inputs))
  }
  return capabilities
}

/**
 * The capability kinds an inventory can actually produce today.
 *
 * Exported so a test can fail when the shipped `ContextRole` starts mapping to
 * something new without the migration map being updated — the map in
 * `docs/technical/extension-migration-map.md` is a promise, and this is what
 * keeps it from quietly going stale.
 */
export const KindsReachableFromInventory: ReadonlyArray<CapabilityKind> = [
  CapabilityKind.Instruction,
  CapabilityKind.Skill,
  CapabilityKind.Command,
  CapabilityKind.Subagent,
  CapabilityKind.Prompt,
  CapabilityKind.Hook,
]
