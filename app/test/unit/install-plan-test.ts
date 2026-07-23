import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildInstallPlan,
  decideInstall,
  planApprovalMatches,
  IInstallCandidate,
  IInstallContext,
} from '../../src/lib/marketplace/install-plan'
import { AgentId } from '../../src/models/workspace-inventory'
import {
  CapabilityKind,
  CapabilityScope,
  ExtensionSource,
  IMcpServer,
} from '../../src/models/extension'
import { IntegrityVerdict } from '../../src/models/marketplace'

// Everything here is pure: no I/O, no randomness, deterministic. The security of
// this feature is PROVEN here — that the plan is specific (exact files, exact
// paths, exact command+args), that refusal is first-class, that a secret never
// rides along, and that a generic confirm cannot stand in for reviewing THIS
// plan.

const INSTALL_ROOT = '/home/dev/.claude'

// A digest that matches the shape #51 produces on a passing checksum.
const OK_VERDICT: IntegrityVerdict = {
  kind: 'checksum-only',
  digest: 'a'.repeat(64),
}

function context(overrides: Partial<IInstallContext> = {}): IInstallContext {
  return {
    installRoot: INSTALL_ROOT,
    agent: AgentId.ClaudeCode,
    scope: CapabilityScope.Global,
    existingFiles: new Map<string, string>(),
    policyBlock: null,
    ...overrides,
  }
}

function candidate(
  overrides: Partial<IInstallCandidate> = {}
): IInstallCandidate {
  return {
    name: 'example-review',
    version: '1.2.3',
    kind: CapabilityKind.Skill,
    agent: AgentId.ClaudeCode,
    source: ExtensionSource.Marketplace,
    sourceRef: 'registry.example/example-review',
    files: [
      {
        relativePath: 'skills/example-review/SKILL.md',
        sha256: 'b'.repeat(64),
        byteLength: 4200,
      },
      {
        relativePath: 'skills/example-review/checklist.md',
        sha256: 'c'.repeat(64),
        byteLength: 1100,
      },
    ],
    mcpServers: [],
    declaredPermissions: [],
    ...overrides,
  }
}

const POSTGRES_MCP: IMcpServer = {
  name: 'mcp-postgres',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@example/mcp-postgres', '--dsn', '$DATABASE_URL'],
  envKeys: ['DATABASE_URL'],
  declaredIn: 'settings.json',
}

describe('buildInstallPlan — the plan is SPECIFIC', () => {
  it('lists the exact files with their exact absolute destinations', () => {
    const plan = buildInstallPlan(candidate(), OK_VERDICT, context())

    assert.notStrictEqual(plan, null)
    assert.strictEqual(plan!.files.length, 2)

    const [skill, checklist] = plan!.files

    // The EXACT destination path, not a generic "some files".
    assert.strictEqual(
      skill.destinationPath,
      '/home/dev/.claude/skills/example-review/SKILL.md'
    )
    assert.strictEqual(skill.action, 'create')
    assert.strictEqual(skill.existingSha256, null)
    assert.strictEqual(skill.file.byteLength, 4200)
    assert.strictEqual(skill.file.sha256, 'b'.repeat(64))

    assert.strictEqual(
      checklist.destinationPath,
      '/home/dev/.claude/skills/example-review/checklist.md'
    )
  })

  it('discloses the MCP spawn command and args VERBATIM', () => {
    const plan = buildInstallPlan(
      candidate({ mcpServers: [POSTGRES_MCP] }),
      OK_VERDICT,
      context()
    )

    assert.notStrictEqual(plan, null)
    assert.strictEqual(plan!.mcpServers.length, 1)

    const server = plan!.mcpServers[0]
    // The literal command and args the agent would spawn — not a generic blob.
    assert.strictEqual(server.command, 'npx')
    assert.deepStrictEqual(server.args, [
      '-y',
      '@example/mcp-postgres',
      '--dsn',
      '$DATABASE_URL',
    ])
    // The fact that a child process would be spawned is explicit.
    assert.strictEqual(server.spawnsProcess, true)
    // NAMES only.
    assert.deepStrictEqual(server.envKeys, ['DATABASE_URL'])
  })

  it('marks an existing destination as an overwrite and discloses its hash', () => {
    const existing = new Map<string, string>([
      ['/home/dev/.claude/skills/example-review/SKILL.md', 'd'.repeat(64)],
    ])
    const plan = buildInstallPlan(
      candidate(),
      OK_VERDICT,
      context({ existingFiles: existing })
    )

    const skill = plan!.files.find(f => f.destinationPath.endsWith('SKILL.md'))!
    assert.strictEqual(skill.action, 'overwrite')
    assert.strictEqual(skill.existingSha256, 'd'.repeat(64))
  })

  it('a non-stdio MCP server discloses no spawn', () => {
    const httpServer: IMcpServer = {
      name: 'remote',
      transport: 'http',
      command: null,
      args: [],
      envKeys: [],
      declaredIn: 'settings.json',
    }
    const plan = buildInstallPlan(
      candidate({ mcpServers: [httpServer] }),
      OK_VERDICT,
      context()
    )
    assert.strictEqual(plan!.mcpServers[0].spawnsProcess, false)
    assert.strictEqual(plan!.mcpServers[0].command, null)
  })
})

describe('buildInstallPlan — path safety, refusal at construction', () => {
  const escapingPaths = [
    '../../etc/passwd',
    '/etc/passwd',
    '~/x',
    '..\\..\\x',
    'a/../../b',
    'CON',
    'nested/PRN.txt',
    `has${String.fromCharCode(0)}nul`,
  ]

  for (const bad of escapingPaths) {
    it(`refuses a package whose path is ${JSON.stringify(bad)}`, () => {
      const plan = buildInstallPlan(
        candidate({
          files: [{ relativePath: bad, sha256: 'e'.repeat(64), byteLength: 1 }],
        }),
        OK_VERDICT,
        context()
      )
      // A plan that would leave the root is not built at all.
      assert.strictEqual(plan, null)
    })
  }

  it('decideInstall turns an escaping path into a first-class refusal', () => {
    const decision = decideInstall(
      candidate({
        files: [
          {
            relativePath: '../../../.ssh/authorized_keys',
            sha256: 'e'.repeat(64),
            byteLength: 1,
          },
        ],
      }),
      OK_VERDICT,
      context()
    )
    assert.strictEqual(decision.kind, 'refused')
    if (decision.kind === 'refused') {
      assert.strictEqual(decision.reason, 'escapes-install-root')
    }
  })
})

describe('decideInstall — refusal is first-class', () => {
  it('a failed integrity verdict is refused, and NO plan leaks through', () => {
    const decision = decideInstall(
      candidate(),
      { kind: 'failed', reason: 'digest-mismatch' },
      context()
    )
    assert.strictEqual(decision.kind, 'refused')
    if (decision.kind === 'refused') {
      assert.strictEqual(decision.reason, 'integrity-failed')
      // The union has no `plan` on the refused branch — a plan cannot leak.
      assert.strictEqual('plan' in decision, false)
    }
  })

  it('an unverifiable verdict (digest expected) is refused', () => {
    const decision = decideInstall(
      candidate(),
      { kind: 'unverifiable', reason: 'no-published-digest' },
      context()
    )
    assert.strictEqual(decision.kind, 'refused')
    if (decision.kind === 'refused') {
      assert.strictEqual(decision.reason, 'integrity-unverifiable')
    }
  })

  it('a policy block is refused with the reason (not a hidden button)', () => {
    const decision = decideInstall(
      candidate(),
      OK_VERDICT,
      context({ policyBlock: 'Blocked by org policy: no external MCP.' })
    )
    assert.strictEqual(decision.kind, 'refused')
    if (decision.kind === 'refused') {
      assert.strictEqual(decision.reason, 'blocked-by-policy')
      assert.match(decision.detail, /org policy/)
    }
  })

  it('integrity is gated BEFORE policy and before the plan', () => {
    // Even with a policy block set, a failed verdict reports the integrity
    // failure first — integrity is the first gate.
    const decision = decideInstall(
      candidate(),
      { kind: 'failed', reason: 'bad-signature' },
      context({ policyBlock: 'also blocked' })
    )
    assert.strictEqual(decision.kind, 'refused')
    if (decision.kind === 'refused') {
      assert.strictEqual(decision.reason, 'integrity-failed')
    }
  })

  it('a valid candidate + passing verdict is ready-for-review', () => {
    const decision = decideInstall(
      candidate({ mcpServers: [POSTGRES_MCP] }),
      OK_VERDICT,
      context()
    )
    assert.strictEqual(decision.kind, 'ready-for-review')
    if (decision.kind === 'ready-for-review') {
      assert.strictEqual(decision.plan.files.length, 2)
      assert.strictEqual(decision.plan.mcpServers[0].command, 'npx')
      // The verdict is disclosed, never distilled to "safe".
      assert.strictEqual(decision.plan.integrity.kind, 'checksum-only')
    }
  })
})

describe('approval requires echoing the SPECIFIC plan', () => {
  it('the exact planId confirms; a generic string or empty does not', () => {
    const plan = buildInstallPlan(candidate(), OK_VERDICT, context())!

    assert.strictEqual(planApprovalMatches(plan, plan.planId), true)
    assert.strictEqual(planApprovalMatches(plan, 'OK'), false)
    assert.strictEqual(planApprovalMatches(plan, ''), false)
    assert.strictEqual(planApprovalMatches(plan, undefined), false)
  })

  it('a DIFFERENT plan id does not confirm this plan', () => {
    const planA = buildInstallPlan(candidate(), OK_VERDICT, context())!
    // A plan whose MCP command differs is a different plan with a different id.
    const planB = buildInstallPlan(
      candidate({ mcpServers: [POSTGRES_MCP] }),
      OK_VERDICT,
      context()
    )!

    assert.notStrictEqual(planA.planId, planB.planId)
    assert.strictEqual(planApprovalMatches(planA, planB.planId), false)
  })

  it('the planId is stable across identical inputs', () => {
    const one = buildInstallPlan(candidate(), OK_VERDICT, context())!
    const two = buildInstallPlan(candidate(), OK_VERDICT, context())!
    assert.strictEqual(one.planId, two.planId)
  })
})

describe('no secret ever rides along in the plan', () => {
  it('an env VALUE planted on the input never appears in the plan', () => {
    const SECRET = 'super-secret-token-xyz-do-not-leak'

    // Simulate a sloppy upstream manifest that smuggled an env VALUE onto the
    // MCP declaration (the type has no such field — this is a cast to prove the
    // plan reads names-only and copies nothing else).
    const leakyServer = {
      ...POSTGRES_MCP,
      envKeys: ['DATABASE_URL'],
      // Fields the type does not have; must never be copied into the plan.
      envValues: { DATABASE_URL: SECRET },
      token: SECRET,
    } as unknown as IMcpServer

    const plan = buildInstallPlan(
      candidate({ mcpServers: [leakyServer] }),
      OK_VERDICT,
      context()
    )!

    const serialized = JSON.stringify(plan)
    assert.strictEqual(
      serialized.includes(SECRET),
      false,
      'the plan must never surface a secret env value'
    )
    // The NAME is still disclosed, so the user sees what the process reads.
    assert.deepStrictEqual(plan.mcpServers[0].envKeys, ['DATABASE_URL'])
  })
})

describe('edge and empty inputs — well-formed, never throw', () => {
  it('an empty package yields a well-formed plan with zero files', () => {
    const plan = buildInstallPlan(
      candidate({ files: [], mcpServers: [], declaredPermissions: [] }),
      OK_VERDICT,
      context()
    )
    assert.notStrictEqual(plan, null)
    assert.strictEqual(plan!.files.length, 0)
    assert.strictEqual(plan!.mcpServers.length, 0)
    assert.strictEqual(typeof plan!.planId, 'string')
    assert.ok(plan!.planId.length > 0)
  })

  it('decideInstall on an empty valid package is ready-for-review', () => {
    const decision = decideInstall(
      candidate({ files: [] }),
      OK_VERDICT,
      context()
    )
    assert.strictEqual(decision.kind, 'ready-for-review')
  })
})
