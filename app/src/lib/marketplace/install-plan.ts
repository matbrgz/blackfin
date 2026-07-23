// The install *plan* and the install *decision* (issue #50), under the ratified
// trust RFC (#12, `docs/superpowers/rfcs/2026-07-12-trust.md`, D1 = disclosure
// over containment).
//
// This module is PURE: no network, no disk, no clock, no randomness, no React.
// It NEVER throws — a malformed candidate, an empty package, a path that escapes
// the install root, a failed integrity verdict all return a well-formed value,
// because refusal is a VALUE, not an exception (the shape of `CleanupOutcome`,
// `app/src/lib/workspace/cleanup.ts:24`).
//
// What it does, and the whole of what it does:
//   1. From a downloaded, already-verified candidate it BUILDS a SPECIFIC,
//      reviewable plan — the EXACT files that WOULD be written with their EXACT
//      destination paths, the EXACT MCP `command` + `args` the agent would
//      spawn (surfaced verbatim so the user reads what will run), the declared
//      permissions, and the integrity verdict — so the review is specific, not a
//      generic "this item wants permissions [OK]".
//   2. It DECIDES: a failed / unverifiable integrity verdict, a policy block, or
//      a packaged path that would escape the install root each yield a
//      first-class `refused` — never a plan-with-a-warning that still lets
//      install proceed. There is no "install anyway".
//
// What it does NOT do, and MUST NOT: write a byte, download anything, spawn a
// process, read the disk, or assert that an extension is SAFE. Blackfin has no
// sandbox (`app/src/main-process/app-window.ts:74-81`); the plan DISCLOSES what
// would be written and by what command — it never claims to contain what the
// agent does with it afterward. Execution and UI are the runtime follow-up
// (#35 is the one and only installer; this issue produces a plan and a verdict).
//
// SHA-256 (for the stable plan id) comes from Node's `crypto`, exactly as
// `app/src/lib/marketplace/integrity.ts` already uses it — a pure, deterministic
// computation, no new dependency.

import { createHash } from 'crypto'
import * as Path from 'path'
import { AgentId } from '../../models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  ExtensionSource,
  IMcpServer,
} from '../../models/extension'
import {
  IDeclaredPermission,
  IInstalledFile,
} from '../../models/extension-registry'
import { IntegrityVerdict } from '../../models/marketplace'

/**
 * One file the downloaded package would write. `IInstalledFile`-shaped (reused
 * from #35, `extension-registry.ts`): a POSIX relative path, its sha256, its
 * byte length. This is the raw material of the plan, before the destination is
 * resolved against the install root. No content bytes ride along here — the plan
 * discloses WHAT and WHERE, and the executor (#35) is what reads the bytes.
 */
export interface IPackagedFile {
  /** POSIX, relative to the item root, as the package declares it. */
  readonly relativePath: string
  readonly sha256: string
  readonly byteLength: number
}

/**
 * The candidate to install: a package whose bytes were already downloaded and
 * whose integrity was already checked by #51 (this module CONSUMES the verdict,
 * it does not compute it). Everything here is a declaration by a third party
 * Blackfin did not write — it is disclosed, never trusted.
 */
export interface IInstallCandidate {
  readonly name: string
  readonly version: string | null
  readonly kind: CapabilityKind
  readonly agent: AgentId
  readonly source: ExtensionSource
  /** Reused convention: URL, git remote+ref, or marketplace id. Never a secret. */
  readonly sourceRef: string | null
  /** The complete, untruncated list of files the package would write. */
  readonly files: ReadonlyArray<IPackagedFile>
  /**
   * MCP servers this item registers. Each is surfaced as a spawn disclosure —
   * `IMcpServer` carries `envKeys` (NAMES only) and has NO slot for an env value,
   * so a value cannot leak through this path even by mistake (#21, RFC #11 §13).
   */
  readonly mcpServers: ReadonlyArray<IMcpServer>
  readonly declaredPermissions: ReadonlyArray<IDeclaredPermission>
}

/** What the plan would do to a given destination: write anew, or replace. */
export type PlannedFileAction = 'create' | 'overwrite'

/**
 * A single file in the plan: the `IInstalledFile`-shaped record, its resolved
 * ABSOLUTE destination under the install root, whether it creates or overwrites,
 * and — when it overwrites — the sha256 of what is there now (disclosed so the
 * user sees a replacement is a replacement, never a silent one).
 */
export interface IPlannedFile {
  readonly file: IInstalledFile
  readonly destinationPath: string
  readonly action: PlannedFileAction
  readonly existingSha256: string | null
}

/**
 * The disclosure of an MCP server the agent would spawn. The `command` and
 * `args` are surfaced VERBATIM — the whole point of the review is that the user
 * reads the literal line that will run (`npx -y @example/mcp-postgres --dsn
 * $DATABASE_URL`), not a generic "wants to run a process". `envKeys` are NAMES
 * only. `spawnsProcess` is the honest, explicit fact that a stdio server becomes
 * a child process of the user's agent — disclosed, never auto-approved.
 */
export interface IMcpSpawnDisclosure {
  readonly name: string
  readonly transport: IMcpServer['transport']
  /** The literal command the agent would spawn. `null` for a non-stdio server. */
  readonly command: string | null
  /** The literal arguments, verbatim and in order. */
  readonly args: ReadonlyArray<string>
  /** NAMES only — never a value. */
  readonly envKeys: ReadonlyArray<string>
  /** true ⇒ installing this would cause a local child process to be spawned. */
  readonly spawnsProcess: boolean
}

/**
 * The state of the disk that the plan was built against, passed IN as an
 * argument (this module never reads the disk). `existingFiles` maps an absolute
 * destination path to the sha256 currently there, so the plan can mark a
 * replacement and disclose what it replaces. `policyBlock`, when non-null, is the
 * organisation policy (#53) that forbids this item — a reason string, applied in
 * the DECISION, not by hiding a button.
 */
export interface IInstallContext {
  /** The absolute root every file must resolve at or beneath. */
  readonly installRoot: string
  readonly agent: AgentId
  readonly scope: CapabilityScope
  /** Absolute destination path -> current sha256. Empty when nothing exists. */
  readonly existingFiles: ReadonlyMap<string, string>
  /** A #53 policy refusal reason, or null when policy permits. */
  readonly policyBlock: string | null
}

/**
 * A specific, reviewable install plan. It carries a stable `planId` (a sha256 of
 * every decision-relevant fact) that the caller must ECHO to confirm — so a
 * generic "OK" cannot stand in for having reviewed THIS exact command and THESE
 * exact files. It embeds the integrity verdict for disclosure; it never distils
 * that verdict into "safe".
 */
export interface IInstallPlan {
  /** Stable across identical inputs; changes if any reviewed fact changes. */
  readonly planId: string
  readonly item: {
    readonly name: string
    readonly version: string | null
    readonly kind: CapabilityKind
    readonly agent: AgentId
    readonly source: ExtensionSource
    readonly sourceRef: string | null
  }
  readonly installRoot: string
  /** The COMPLETE list — no truncation, no "and N more". */
  readonly files: ReadonlyArray<IPlannedFile>
  readonly mcpServers: ReadonlyArray<IMcpSpawnDisclosure>
  readonly declaredPermissions: ReadonlyArray<IDeclaredPermission>
  /** Disclosed as found (#51). Never collapsed to a boolean "safe". */
  readonly integrity: IntegrityVerdict
}

/** A machine-readable reason an install was refused. Refusal is first-class. */
export type InstallRefusalReason =
  | 'integrity-failed'
  | 'integrity-unverifiable'
  | 'escapes-install-root'
  | 'blocked-by-policy'

/**
 * The decision. Either the plan is ready for the user to review and confirm, or
 * the install is REFUSED — a typed value with a machine-readable reason and a
 * human detail, never an exception and never a plan that leaks through with a
 * warning attached.
 */
export type IInstallDecision =
  | { readonly kind: 'ready-for-review'; readonly plan: IInstallPlan }
  | {
      readonly kind: 'refused'
      readonly reason: InstallRefusalReason
      readonly detail: string
    }

/** Windows reserved device names — invalid as any path segment. No control chars. */
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** A leading Windows drive letter, e.g. `C:` — an absolute path in disguise. */
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/

/**
 * Resolve a packaged relative path to a safe POSIX path underneath the root, or
 * return `null` if it would escape. PURE — Path.posix over backslash-normalized
 * input, because native `Path` is `path.win32` on the Windows CI job and would
 * mis-handle POSIX separators (issue #50 hard constraint). Every escape vector
 * the issue names is rejected HERE, before any plan is shown: `..` traversal,
 * an absolute path from the package, a Windows drive, a `~` home symbol, a null
 * byte, and Windows reserved device names.
 */
function safeRelativePath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return null
  }

  // Null bytes have no place in a path. Checked by index of the literal NUL
  // character, not by a control-char regex (satisfies no-control-regex).
  if (rawPath.indexOf(String.fromCharCode(0)) !== -1) {
    return null
  }

  // Normalize Windows separators to POSIX so a `..\\..\\x` traversal cannot slip
  // past a POSIX-only check.
  const forward = rawPath.replace(/\\/g, '/')

  // An absolute path, a drive-letter path, or a home symbol from the package is
  // never joined to the root — it is an escape.
  if (
    forward.startsWith('/') ||
    forward.startsWith('~') ||
    WINDOWS_DRIVE_PREFIX.test(forward)
  ) {
    return null
  }

  const normalized = Path.posix.normalize(forward)

  // After normalization, any remaining traversal or absoluteness escapes.
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized.length === 0 ||
    normalized === '.'
  ) {
    return null
  }

  // Reserved Windows device names, per segment (the base before any extension).
  for (const segment of normalized.split('/')) {
    if (segment.length === 0) {
      continue
    }
    const base = segment.split('.')[0]
    if (RESERVED_WINDOWS_NAME.test(base)) {
      return null
    }
  }

  return normalized
}

/** Normalize the install root to a trailing-slash-free POSIX prefix for joining. */
function posixRoot(installRoot: string): string {
  return installRoot.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Map an MCP server declaration to its spawn disclosure — names/args only. */
function discloseMcpServer(server: IMcpServer): IMcpSpawnDisclosure {
  const command =
    typeof server.command === 'string' && server.command.length > 0
      ? server.command
      : null
  return {
    name: server.name,
    transport: server.transport,
    command,
    // Copy the array so the plan cannot be mutated through the input reference.
    args: [...server.args],
    // NAMES only. `IMcpServer` has no field capable of holding a value.
    envKeys: [...server.envKeys],
    // A stdio server with a command becomes a child process of the agent. That
    // fact is disclosed explicitly; it is never treated as pre-approved.
    spawnsProcess: server.transport === 'stdio' && command !== null,
  }
}

/**
 * A canonical, order-stable serialization of every fact a reviewer would judge,
 * hashed to the `planId`. Two plans that differ in any reviewed fact — a file, a
 * destination, an MCP command or arg, a declared permission, the integrity
 * verdict — produce different ids, so echoing an old id cannot confirm a changed
 * plan. Env values are impossible here (there is no such field); only names ride
 * along.
 */
function computePlanId(
  item: IInstallPlan['item'],
  files: ReadonlyArray<IPlannedFile>,
  mcpServers: ReadonlyArray<IMcpSpawnDisclosure>,
  declaredPermissions: ReadonlyArray<IDeclaredPermission>,
  integrity: IntegrityVerdict
): string {
  const canonical = JSON.stringify({
    item,
    files: files.map(planned => ({
      relativePath: planned.file.relativePath,
      sha256: planned.file.sha256,
      byteLength: planned.file.byteLength,
      destinationPath: planned.destinationPath,
      action: planned.action,
      existingSha256: planned.existingSha256,
    })),
    mcpServers: mcpServers.map(server => ({
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      envKeys: server.envKeys,
      spawnsProcess: server.spawnsProcess,
    })),
    declaredPermissions: declaredPermissions.map(permission => ({
      id: permission.id,
      reason: permission.reason,
    })),
    integrity,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Build the SPECIFIC, reviewable plan from a candidate, its integrity verdict
 * (embedded for disclosure), and the disk context. PURE; never throws; writes
 * nothing.
 *
 * Returns `null` when ANY packaged file would resolve outside the install root —
 * a plan that would leave the root is not a plan, it is a refusal, and
 * `decideInstall` surfaces it as `escapes-install-root`. This function does NOT
 * gate on the integrity verdict or policy — that is `decideInstall`'s job (a
 * failed verdict means no plan is built at all); here the verdict is embedded so
 * the review can disclose it. Callers wanting the decision should use
 * `decideInstall`.
 */
export function buildInstallPlan(
  candidate: IInstallCandidate,
  integrityVerdict: IntegrityVerdict,
  context: IInstallContext
): IInstallPlan | null {
  const root = posixRoot(context.installRoot)
  const files: IPlannedFile[] = []

  for (const packaged of candidate.files ?? []) {
    const safe = safeRelativePath(packaged?.relativePath)
    if (safe === null) {
      // One escaping path invalidates the whole plan — nothing is shown.
      return null
    }

    const destinationPath = Path.posix.join(root, safe)
    const existingSha256 = context.existingFiles.get(destinationPath) ?? null

    files.push({
      file: {
        relativePath: safe,
        sha256: packaged.sha256,
        byteLength: packaged.byteLength,
      },
      destinationPath,
      action: existingSha256 === null ? 'create' : 'overwrite',
      existingSha256,
    })
  }

  const mcpServers = (candidate.mcpServers ?? []).map(discloseMcpServer)
  const declaredPermissions = [...(candidate.declaredPermissions ?? [])]

  const item: IInstallPlan['item'] = {
    name: candidate.name,
    version: candidate.version,
    kind: candidate.kind,
    agent: candidate.agent,
    source: candidate.source,
    sourceRef: candidate.sourceRef,
  }

  return {
    planId: computePlanId(
      item,
      files,
      mcpServers,
      declaredPermissions,
      integrityVerdict
    ),
    item,
    installRoot: context.installRoot,
    files,
    mcpServers,
    declaredPermissions,
    integrity: integrityVerdict,
  }
}

/**
 * The decision. Refusal is FIRST-CLASS: a failed integrity verdict, an
 * unverifiable one (verification could not be completed — install cannot
 * proceed), a policy block (#53), or a packaged path that escapes the install
 * root each return `refused`, never a plan a caller could confirm anyway. PURE;
 * never throws.
 *
 * The gate order is a contract, and integrity comes first: when the verdict is
 * `failed` or `unverifiable`, NO plan is built — a bad checksum is a refusal, not
 * a warning attached to an otherwise-shippable plan.
 *
 *   failed        -> refused: integrity-failed
 *   unverifiable  -> refused: integrity-unverifiable
 *   policy block  -> refused: blocked-by-policy
 *   path escape   -> refused: escapes-install-root
 *   otherwise     -> ready-for-review, with the verdict disclosed in the plan
 *
 * `checksum-only`, `unsigned` and `verified-signature` all permit review — the
 * verdict is disclosed in the plan, and the user reviews the specific command
 * and files. Nothing here is ever called "safe".
 */
export function decideInstall(
  candidate: IInstallCandidate,
  integrityVerdict: IntegrityVerdict,
  context: IInstallContext
): IInstallDecision {
  // (1) Integrity gate, first-class and first. A failed verdict is tampering
  // (or an unusable published digest) and refuses; an unverifiable one means
  // verification could not be completed, which blocks install pending a
  // connection/config — either way, no reviewable plan is produced.
  if (integrityVerdict.kind === 'failed') {
    return {
      kind: 'refused',
      reason: 'integrity-failed',
      detail: `Integrity check failed: ${integrityVerdict.reason}.`,
    }
  }
  if (integrityVerdict.kind === 'unverifiable') {
    return {
      kind: 'refused',
      reason: 'integrity-unverifiable',
      detail: `Integrity could not be verified: ${integrityVerdict.reason}.`,
    }
  }

  // (2) Organisation policy (#53). Applied in the decision, not by hiding a
  // button — a blocked item is refused with the reason.
  if (context.policyBlock !== null) {
    return {
      kind: 'refused',
      reason: 'blocked-by-policy',
      detail: context.policyBlock,
    }
  }

  // (3) Build the specific plan. A null result means a packaged path would leave
  // the install root — a refusal, surfaced before any plan is shown.
  const plan = buildInstallPlan(candidate, integrityVerdict, context)
  if (plan === null) {
    return {
      kind: 'refused',
      reason: 'escapes-install-root',
      detail:
        'A file in this package resolves outside the install root and would ' +
        'not be written. The install is refused.',
    }
  }

  return { kind: 'ready-for-review', plan }
}

/**
 * Confirm approval of a SPECIFIC plan: the caller must echo the plan's exact
 * `planId`. A generic confirmation, an empty string, or the id of a DIFFERENT
 * plan does not match — so "OK" can never stand in for having reviewed this
 * command and these files. PURE; never throws.
 */
export function planApprovalMatches(
  plan: IInstallPlan,
  echoedPlanId: unknown
): boolean {
  return (
    typeof echoedPlanId === 'string' &&
    echoedPlanId.length > 0 &&
    echoedPlanId === plan.planId
  )
}
