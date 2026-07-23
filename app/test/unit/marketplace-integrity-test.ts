import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import {
  parseProvenance,
  verifyIntegrity,
} from '../../src/lib/marketplace/integrity'
import { IPublishedIntegrity, ITrustRoot } from '../../src/models/marketplace'

// Deterministic vectors — no I/O, no randomness.
//
// SHA-256("abc") and SHA-256("") are well-known test vectors, so the whole
// suite is reproducible without touching disk or network.
const ABC = Buffer.from('abc')
const SHA256_ABC =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const EMPTY = Buffer.alloc(0)
const SHA256_EMPTY =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

// A fixed Ed25519 vector: this key signed exactly the bytes "abc". Generated
// once with node:crypto and pinned here so the signature test is deterministic.
const ED25519_KEY_ID = 'test-key-1'
const ED25519_PUBLIC_KEY_B64 = 'apYKoZ8BfJSYllA0zHeO+tfzi9d4Fa4YyyoVtcphURI='
const ED25519_SIG_ABC_B64 =
  '5qZoopQIfqfpI+Gg2pfj5c7HCBjGQzKi+4OJCi6se9nXd/gsCjJYozuMiCHjs1RCfgRfjzBkgpZ5Qe2NDlo4DQ=='

function published(
  overrides: Partial<IPublishedIntegrity> = {}
): IPublishedIntegrity {
  return {
    algorithm: 'sha256',
    digest: SHA256_ABC,
    sizeInBytes: ABC.length,
    signature: null,
    ...overrides,
  }
}

function trustRootWithKey(): ITrustRoot {
  return {
    keys: [{ keyId: ED25519_KEY_ID, publicKey: ED25519_PUBLIC_KEY_B64 }],
    revoked: new Set<string>(),
  }
}

const signature = {
  algorithm: 'ed25519' as const,
  value: ED25519_SIG_ABC_B64,
  keyId: ED25519_KEY_ID,
}

describe('verifyIntegrity — checksum', () => {
  it('matching digest, no signature -> checksum-only', () => {
    const verdict = verifyIntegrity(ABC, published(), null)
    assert.deepStrictEqual(verdict, {
      kind: 'checksum-only',
      digest: SHA256_ABC,
    })
  })

  it('tampered bytes (one byte changed) -> failed:digest-mismatch', () => {
    const tampered = Buffer.from('abd')
    const verdict = verifyIntegrity(tampered, published(), null)
    assert.deepStrictEqual(verdict, {
      kind: 'failed',
      reason: 'digest-mismatch',
    })
  })

  it('size disagrees but digest matches -> failed:size-mismatch', () => {
    const verdict = verifyIntegrity(ABC, published({ sizeInBytes: 999 }), null)
    assert.deepStrictEqual(verdict, { kind: 'failed', reason: 'size-mismatch' })
  })

  it('uppercase / whitespaced digest is normalized and still matches', () => {
    const messy = `  ${SHA256_ABC.toUpperCase()}  `
    const verdict = verifyIntegrity(ABC, published({ digest: messy }), null)
    assert.deepStrictEqual(verdict, {
      kind: 'checksum-only',
      digest: SHA256_ABC,
    })
  })

  it('empty digest string -> failed, never checksum-only', () => {
    const verdict = verifyIntegrity(ABC, published({ digest: '' }), null)
    assert.strictEqual(verdict.kind, 'failed')
  })

  it('non-hex digest -> failed, never checksum-only', () => {
    const bad = 'z'.repeat(64)
    const verdict = verifyIntegrity(ABC, published({ digest: bad }), null)
    assert.deepStrictEqual(verdict, {
      kind: 'failed',
      reason: 'digest-mismatch',
    })
  })

  it('wrong-length digest -> failed, never checksum-only', () => {
    const verdict = verifyIntegrity(ABC, published({ digest: 'abc123' }), null)
    assert.deepStrictEqual(verdict, {
      kind: 'failed',
      reason: 'digest-mismatch',
    })
  })

  it('digest field null -> unverifiable:no-published-digest', () => {
    const verdict = verifyIntegrity(
      ABC,
      published({ digest: null as unknown as string }),
      null
    )
    assert.deepStrictEqual(verdict, {
      kind: 'unverifiable',
      reason: 'no-published-digest',
    })
  })

  it('unsupported algorithm -> unverifiable, never throws', () => {
    const verdict = verifyIntegrity(
      ABC,
      published({ algorithm: 'sha512' as unknown as 'sha256' }),
      null
    )
    assert.strictEqual(verdict.kind, 'unverifiable')
  })

  it('empty bytes with the digest of empty bytes -> checksum-only (not special-cased)', () => {
    const verdict = verifyIntegrity(
      EMPTY,
      published({ digest: SHA256_EMPTY, sizeInBytes: 0 }),
      null
    )
    assert.deepStrictEqual(verdict, {
      kind: 'checksum-only',
      digest: SHA256_EMPTY,
    })
  })
})

describe('verifyIntegrity — the registry is not an authority', () => {
  it('a registry object with verified:true and a divergent digest still fails', () => {
    // The registry's self-serving verdict is a field this function never reads.
    const hostile = {
      ...published({ digest: SHA256_EMPTY, sizeInBytes: ABC.length }),
      verified: true,
    } as unknown as IPublishedIntegrity
    const verdict = verifyIntegrity(ABC, hostile, null)
    assert.deepStrictEqual(verdict, {
      kind: 'failed',
      reason: 'digest-mismatch',
    })
  })
})

describe('verifyIntegrity — signature', () => {
  it('signature present, trustRoot null -> unverifiable:no-trust-root (never verified)', () => {
    const verdict = verifyIntegrity(ABC, published({ signature }), null)
    assert.deepStrictEqual(verdict, {
      kind: 'unverifiable',
      reason: 'no-trust-root',
    })
    assert.notStrictEqual(verdict.kind, 'verified-signature')
  })

  it('valid signature, key in trust root -> verified-signature', () => {
    const verdict = verifyIntegrity(
      ABC,
      published({ signature }),
      trustRootWithKey()
    )
    assert.deepStrictEqual(verdict, {
      kind: 'verified-signature',
      keyId: ED25519_KEY_ID,
      digest: SHA256_ABC,
    })
  })

  it('tampered signature, key in trust root -> failed:bad-signature', () => {
    // Flip a character in the base64 signature.
    const badValue = ED25519_SIG_ABC_B64.replace('5qZ', '6qZ')
    const verdict = verifyIntegrity(
      ABC,
      published({ signature: { ...signature, value: badValue } }),
      trustRootWithKey()
    )
    assert.deepStrictEqual(verdict, { kind: 'failed', reason: 'bad-signature' })
  })

  it('valid signature but keyId revoked -> failed:revoked-key', () => {
    const root: ITrustRoot = {
      keys: [{ keyId: ED25519_KEY_ID, publicKey: ED25519_PUBLIC_KEY_B64 }],
      revoked: new Set<string>([ED25519_KEY_ID]),
    }
    const verdict = verifyIntegrity(ABC, published({ signature }), root)
    assert.deepStrictEqual(verdict, { kind: 'failed', reason: 'revoked-key' })
  })

  it('signature under a key the trust root does not carry -> unverifiable', () => {
    const root: ITrustRoot = {
      keys: [{ keyId: 'some-other-key', publicKey: ED25519_PUBLIC_KEY_B64 }],
      revoked: new Set<string>(),
    }
    const verdict = verifyIntegrity(ABC, published({ signature }), root)
    assert.deepStrictEqual(verdict, {
      kind: 'unverifiable',
      reason: 'no-trust-root',
    })
  })

  it('malformed public key in trust root -> failed:bad-signature, never throws', () => {
    const root: ITrustRoot = {
      keys: [{ keyId: ED25519_KEY_ID, publicKey: 'not-a-real-key!!!' }],
      revoked: new Set<string>(),
    }
    const verdict = verifyIntegrity(ABC, published({ signature }), root)
    assert.strictEqual(verdict.kind, 'failed')
  })

  it('signature valid for other bytes does not verify these bytes', () => {
    // The signature is over "abc"; present it alongside the empty artifact.
    const verdict = verifyIntegrity(
      EMPTY,
      published({ digest: SHA256_EMPTY, sizeInBytes: 0, signature }),
      trustRootWithKey()
    )
    // The digest of EMPTY matches, so we reach the signature check; the
    // signature is over ABC, so it must not verify EMPTY.
    assert.deepStrictEqual(verdict, { kind: 'failed', reason: 'bad-signature' })
  })
})

describe('verifyIntegrity — never throws on garbage input', () => {
  it('handles null/undefined published without throwing', () => {
    assert.doesNotThrow(() =>
      verifyIntegrity(ABC, null as unknown as IPublishedIntegrity, null)
    )
    const verdict = verifyIntegrity(
      ABC,
      null as unknown as IPublishedIntegrity,
      null
    )
    assert.strictEqual(verdict.kind, 'unverifiable')
  })

  it('handles non-buffer bytes without throwing', () => {
    const verdict = verifyIntegrity(
      'not bytes' as unknown as Uint8Array,
      published(),
      null
    )
    assert.strictEqual(verdict.kind, 'failed')
  })

  it('accepts a plain Uint8Array as well as a Buffer', () => {
    const u8 = new Uint8Array([0x61, 0x62, 0x63]) // "abc"
    const verdict = verifyIntegrity(u8, published(), null)
    assert.deepStrictEqual(verdict, {
      kind: 'checksum-only',
      digest: SHA256_ABC,
    })
  })
})

describe('verifyIntegrity — never reports a plain "safe" verdict', () => {
  it('no verdict kind is "safe"/"trusted"/"verified"/"sandboxed" across every branch', () => {
    const cases = [
      verifyIntegrity(ABC, published(), null),
      verifyIntegrity(Buffer.from('abd'), published(), null),
      verifyIntegrity(ABC, published({ sizeInBytes: 1 }), null),
      verifyIntegrity(ABC, published({ digest: '' }), null),
      verifyIntegrity(
        ABC,
        published({ digest: null as unknown as string }),
        null
      ),
      verifyIntegrity(ABC, published({ signature }), null),
      verifyIntegrity(ABC, published({ signature }), trustRootWithKey()),
    ]
    const forbidden = new Set(['safe', 'trusted', 'verified', 'sandboxed'])
    for (const verdict of cases) {
      assert.ok(
        !forbidden.has(verdict.kind),
        `verdict kind must never be a bare safety word, got "${verdict.kind}"`
      )
    }
  })

  it('the verified-signature verdict carries a direct object, not a bare "verified"', () => {
    const verdict = verifyIntegrity(
      ABC,
      published({ signature }),
      trustRootWithKey()
    )
    // "verified-signature" names WHAT was verified; there is no bare "verified".
    assert.strictEqual(verdict.kind, 'verified-signature')
  })

  it('a matching checksum is checksum-only, never upgraded to a signature verdict', () => {
    const verdict = verifyIntegrity(ABC, published(), null)
    assert.notStrictEqual(verdict.kind, 'verified-signature')
    assert.strictEqual(verdict.kind, 'checksum-only')
  })
})

describe('parseProvenance — disclosure of where-from, absence first-class', () => {
  it('a record with facts is reported as present', () => {
    const report = parseProvenance({
      origin: 'https://github.com/foo/bar',
      ref: 'abc123',
      claimedAuthor: 'foo',
    })
    assert.deepStrictEqual(report, {
      kind: 'present',
      origin: 'https://github.com/foo/bar',
      ref: 'abc123',
      claimedAuthor: { value: 'foo', verified: false },
    })
  })

  it('author is always reported as merely claimed, never verified', () => {
    const report = parseProvenance({ claimedAuthor: 'someone' })
    assert.strictEqual(report.kind, 'present')
    if (report.kind === 'present') {
      assert.deepStrictEqual(report.claimedAuthor, {
        value: 'someone',
        verified: false,
      })
    }
  })

  it('a null record is absent, not fabricated', () => {
    assert.deepStrictEqual(parseProvenance(null), { kind: 'absent' })
    assert.deepStrictEqual(parseProvenance(undefined), { kind: 'absent' })
  })

  it('a record that carries no usable fact is absent, not present-with-nulls', () => {
    assert.deepStrictEqual(
      parseProvenance({ origin: null, ref: null, claimedAuthor: '' }),
      { kind: 'absent' }
    )
  })

  it('partial provenance keeps missing fields null rather than inventing them', () => {
    const report = parseProvenance({ origin: 'https://example.com/pkg' })
    assert.deepStrictEqual(report, {
      kind: 'present',
      origin: 'https://example.com/pkg',
      ref: null,
      claimedAuthor: null,
    })
  })
})

describe('parseProvenance — deterministic digest vector sanity', () => {
  it('the pinned SHA-256 vectors are what node:crypto computes', () => {
    assert.strictEqual(
      createHash('sha256').update(ABC).digest('hex'),
      SHA256_ABC
    )
    assert.strictEqual(
      createHash('sha256').update(EMPTY).digest('hex'),
      SHA256_EMPTY
    )
  })
})
