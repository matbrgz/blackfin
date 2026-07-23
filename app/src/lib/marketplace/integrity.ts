// Integrity verification for marketplace artifacts (issue #51).
//
// This module is the whole point of the issue, and it is deliberately small and
// PURE: no network, no disk, no clock, no randomness — the same inputs always
// produce the same verdict. It NEVER throws: a malformed digest, a wrong-length
// key, empty bytes, a non-hex string, a null record all return a well-formed
// `IntegrityVerdict`, because refusal is a value, not an exception (the shape of
// `CleanupOutcome`, `app/src/lib/workspace/cleanup.ts:24`).
//
// Founding constraint, from the ratified trust RFC (#12,
// `docs/superpowers/rfcs/2026-07-12-trust.md`, D1 = disclosure over
// containment): NOTHING here asserts an extension is safe. The verdict reports
// what was found. It never returns, logs or implies "safe" / "trusted". A
// checksum that matches proves the bytes did not change in transit — it does
// NOT prove the content is safe, nor who published it. See
// `docs/marketplace-integrity.md`.
//
// SHA-256 and Ed25519 come from Node's `crypto`, exactly as
// `app/src/lib/get-file-hash.ts` and `app/src/lib/compute-bundle-hash.ts:39`
// already use it — no new dependency, and none is added to `app/package.json`.

import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'crypto'
import {
  IntegrityVerdict,
  IProvenanceAttestation,
  IPublishedIntegrity,
  ITrustRoot,
  ProvenanceReport,
} from '../../models/marketplace'

/** A lowercase-hex SHA-256 digest is exactly 64 hex characters. */
const SHA256_HEX_LENGTH = 64

/** DER SPKI prefix for a raw Ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** A raw Ed25519 public key is 32 bytes. */
const ED25519_RAW_KEY_LENGTH = 32

/**
 * Normalize a published digest for comparison: trim, drop internal whitespace,
 * lowercase. Returns the 64-char hex string, or `null` if it is not a
 * well-formed lowercase-hex SHA-256 digest after normalization. A `null` here
 * means "the record's digest is unusable", which the caller turns into a
 * refusal — never a silent pass.
 */
function normalizeDigest(digest: unknown): string | null {
  if (typeof digest !== 'string') {
    return null
  }

  const normalized = digest.replace(/\s+/g, '').toLowerCase()

  if (normalized.length !== SHA256_HEX_LENGTH) {
    return null
  }

  // Reject anything that is not lowercase hex. This regex has no control
  // characters (no-control-regex is satisfied): it is a plain hex class.
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return null
  }

  return normalized
}

/**
 * Coerce arbitrary input to a Buffer without throwing. The bytes are the
 * downloaded artifact; if a caller passes something that is not a byte source,
 * we cannot confirm a match, so we return `null` and the caller refuses.
 */
function asBuffer(bytes: unknown): Buffer | null {
  if (Buffer.isBuffer(bytes)) {
    return bytes
  }
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes)
  }
  return null
}

/**
 * Compute the SHA-256 of the bytes and compare it, in constant time, to the
 * expected digest. `timingSafeEqual` over the raw digest buffers removes a whole
 * class of timing argument (issue #51: constant-time comparison is a criterion).
 * Both buffers are exactly 32 bytes, so the length precondition always holds.
 */
function digestMatches(bytes: Buffer, expectedHex: string): boolean {
  const actual = createHash('sha256').update(bytes).digest()
  const expected = Buffer.from(expectedHex, 'hex')

  if (actual.length !== expected.length) {
    return false
  }

  return timingSafeEqual(actual, expected)
}

/**
 * Build a Node public-key object from a trust-root key string without throwing.
 * Accepts base64 of either a raw 32-byte Ed25519 key or a DER SPKI encoding.
 * Returns `null` on any malformed input — the caller treats an unusable key as a
 * verification that cannot succeed.
 */
function toEd25519PublicKey(
  publicKey: string
): ReturnType<typeof createPublicKey> | null {
  try {
    const raw = Buffer.from(publicKey, 'base64')

    const der =
      raw.length === ED25519_RAW_KEY_LENGTH
        ? Buffer.concat([ED25519_SPKI_PREFIX, raw])
        : raw

    return createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

/**
 * Verify integrity of downloaded artifact bytes against what the registry
 * published, optionally under a trust root.
 *
 * PURE. No I/O, no network, no clock. NEVER throws — every failure path returns
 * an `IntegrityVerdict`. This is where all the tests live.
 *
 * The order matters and is a contract:
 *  1. No usable published digest at all           -> unverifiable:no-published-digest
 *  2. A digest that is present but malformed       -> failed:digest-mismatch
 *  3. Bytes that do not hash to the digest         -> failed:digest-mismatch
 *  4. A size field that disagrees with the bytes   -> failed:size-mismatch
 *  5. No signature                                 -> checksum-only
 *  6. Signature but no trust root (the v1 reality) -> unverifiable:no-trust-root
 *  7. Signature over a revoked key                 -> failed:revoked-key
 *  8. Signature under an unknown key               -> unverifiable:no-trust-root
 *  9. A signature that does not verify             -> failed:bad-signature
 * 10. A signature that verifies                    -> verified-signature
 *
 * A registry object may carry extra fields (e.g. a self-serving `verified:
 * true`). This function reads only `algorithm`, `digest`, `sizeInBytes` and
 * `signature`, so such a field cannot influence the verdict: Blackfin does not
 * delegate its verdict to the party being verified.
 */
export function verifyIntegrity(
  bytes: Uint8Array,
  published: IPublishedIntegrity,
  trustRoot: ITrustRoot | null
): IntegrityVerdict {
  // (1) A record with no digest field at all cannot be checked. This is
  // distinct from a present-but-broken digest: absence is `unverifiable` (the
  // user may just be offline / the registry may not publish checksums), a
  // broken digest is `failed`.
  const rawDigest = published?.digest
  if (rawDigest === undefined || rawDigest === null) {
    return { kind: 'unverifiable', reason: 'no-published-digest' }
  }

  // Only SHA-256 is supported. An unsupported algorithm leaves us with no
  // usable published digest to compare against, which is `unverifiable`, not
  // evidence of tampering.
  if (published.algorithm !== 'sha256') {
    return { kind: 'unverifiable', reason: 'no-published-digest' }
  }

  // (2) A present digest that does not normalize to lowercase-hex SHA-256 is
  // unusable. It can never match, so it is a refusal — never `checksum-only`.
  const expected = normalizeDigest(rawDigest)
  if (expected === null) {
    return { kind: 'failed', reason: 'digest-mismatch' }
  }

  const buffer = asBuffer(bytes)
  if (buffer === null) {
    return { kind: 'failed', reason: 'digest-mismatch' }
  }

  // (3) The core checksum check, in constant time.
  if (!digestMatches(buffer, expected)) {
    return { kind: 'failed', reason: 'digest-mismatch' }
  }

  // (4) The bytes match the digest, but if the record's size disagrees with the
  // bytes we actually hold, the record is internally inconsistent. Refuse.
  if (
    typeof published.sizeInBytes !== 'number' ||
    !Number.isFinite(published.sizeInBytes) ||
    buffer.length !== published.sizeInBytes
  ) {
    return { kind: 'failed', reason: 'size-mismatch' }
  }

  const signature = published.signature

  // (5) No signature present. The bytes match the registry; that is the whole
  // fact, and it is `checksum-only` — NEVER `verified-signature`. The UI must
  // say, in the same breath, that this does not prove who published it.
  if (signature === undefined || signature === null) {
    return { kind: 'checksum-only', digest: expected }
  }

  // (6) A signature is present but there is no configured trust root — the v1
  // reality (Blackfin operates no key; RFC #12 §4/§6). The verifier stays inert:
  // it does NOT invent a `verified-signature`. It reports that it could not
  // verify, which blocks install pending a connection/config, not a refusal for
  // tampering.
  if (trustRoot === null) {
    return { kind: 'unverifiable', reason: 'no-trust-root' }
  }

  // (7) A revoked key is an active refusal, not merely "cannot verify".
  if (trustRoot.revoked.has(signature.keyId)) {
    return { kind: 'failed', reason: 'revoked-key' }
  }

  // (8) A signature under a key the trust root does not carry cannot be
  // verified. Not proof of tampering, so `unverifiable`.
  const key = trustRoot.keys.find(k => k.keyId === signature.keyId)
  if (key === undefined) {
    return { kind: 'unverifiable', reason: 'no-trust-root' }
  }

  const publicKey = toEd25519PublicKey(key.publicKey)
  if (publicKey === null) {
    // An unusable key means the signature cannot be shown to be good. We do not
    // hand out `verified-signature` on a key we could not parse.
    return { kind: 'failed', reason: 'bad-signature' }
  }

  let signatureBytes: Buffer
  try {
    signatureBytes = Buffer.from(signature.value, 'base64')
  } catch {
    return { kind: 'failed', reason: 'bad-signature' }
  }

  let ok = false
  try {
    // Ed25519: the algorithm argument to crypto.verify is `null`.
    ok = cryptoVerify(null, buffer, publicKey, signatureBytes)
  } catch {
    // Any failure to even run the verification is treated as a signature that
    // did not check out. We never throw, and we never upgrade to verified.
    return { kind: 'failed', reason: 'bad-signature' }
  }

  // (9) / (10)
  if (!ok) {
    return { kind: 'failed', reason: 'bad-signature' }
  }

  return {
    kind: 'verified-signature',
    keyId: signature.keyId,
    digest: expected,
  }
}

/**
 * Turn an untrusted provenance attestation into a disclosure — the third check
 * named in the issue title. PURE and never-throws, like `verifyIntegrity`.
 *
 * This does NOT fabricate fields the record does not carry: a missing origin
 * stays `null`, and a record that carries nothing at all yields `absent` — a
 * first-class "Blackfin does not know", never a guess (RFC #12 §6). The author,
 * when present, is reported as merely *claimed* (`verified: false`): Blackfin
 * operates no key and cannot check who anyone is. Nothing here asserts safety;
 * provenance narrows who to blame, not whether to trust.
 */
export function parseProvenance(
  record: IProvenanceAttestation | null | undefined
): ProvenanceReport {
  if (record === null || record === undefined) {
    return { kind: 'absent' }
  }

  const origin =
    typeof record.origin === 'string' && record.origin.length > 0
      ? record.origin
      : null
  const ref =
    typeof record.ref === 'string' && record.ref.length > 0 ? record.ref : null
  const author =
    typeof record.claimedAuthor === 'string' && record.claimedAuthor.length > 0
      ? record.claimedAuthor
      : null

  // A record that carries no usable fact at all is honestly "absent": reporting
  // three nulls as "present" would imply Blackfin looked and found emptiness,
  // when in truth the record told it nothing.
  if (origin === null && ref === null && author === null) {
    return { kind: 'absent' }
  }

  return {
    kind: 'present',
    origin,
    ref,
    claimedAuthor: author === null ? null : { value: author, verified: false },
  }
}
