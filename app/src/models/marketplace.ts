// Integrity verification data model (issue #51), under the ratified trust RFC
// (#12, `docs/superpowers/rfcs/2026-07-12-trust.md`) and the ratified
// marketplace architecture RFC (#13). The founding constraint, D1, is
// *disclosure over containment*: nothing in this file — and nothing computed
// from it — ever asserts that an extension is safe. Every type here reports
// *what was found*; none collapses to a boolean `safe`.
//
// There is no field named `safe`, `trusted` or `sandboxed` anywhere in this
// model, and review of this file must reject any addition of one. A field that
// does not exist cannot be set to a lie by mistake.

/**
 * What the registry published about an artifact.
 *
 * NOT TRUSTWORTHY ON ITS OWN. A checksum published by the same entity that
 * publishes the artifact proves transport integrity, never origin authenticity
 * (RFC #12 §6). The verifier consumes this as a claim to check the downloaded
 * bytes against — it never delegates its verdict to it.
 */
export interface IPublishedIntegrity {
  readonly algorithm: 'sha256'
  /** Hex, lowercase. Normalized before comparison; never trusted verbatim. */
  readonly digest: string
  readonly sizeInBytes: number
  /**
   * Optional. While no trust root exists (the v1 reality — RFC #12 §4, §6), a
   * present signature can only ever yield `unverifiable: no-trust-root`, never
   * `verified-signature`. The slot exists; the infrastructure that would make it
   * mean something is #12's decision, not this issue's.
   */
  readonly signature: {
    readonly algorithm: 'ed25519'
    /** base64 */
    readonly value: string
    readonly keyId: string
  } | null
}

/**
 * The trust root against which a signature is checked.
 *
 * DOES NOT EXIST in v1: always `null` at the call site. Blackfin operates no
 * signing key and curates nothing (RFC #13), so the authority that would
 * populate this — who signs, how the key reaches the app, rotation, revocation —
 * is a #12 decision that has not been made. The verifier is written so that it
 * stays inert until it is.
 */
export interface ITrustRoot {
  readonly keys: ReadonlyArray<{
    readonly keyId: string
    /**
     * base64. Either a raw 32-byte Ed25519 public key or a DER SPKI encoding —
     * the verifier accepts both and never throws on a malformed one.
     */
    readonly publicKey: string
  }>
  readonly revoked: ReadonlySet<string>
}

/**
 * A verdict that does not lie. Refusal is a value, not an exception, and the
 * states are chosen so that no one of them can be mistaken for "safe":
 *
 * - `verified-signature` — a key in the trust root signed these exact bytes.
 * - `checksum-only`      — the bytes match what the registry published; **this
 *                          does not prove who published them**.
 * - `unsigned`           — the same fact as `checksum-only`, stated from the
 *                          other direction (retained so a producer/UI can name
 *                          the absence of a signature explicitly).
 * - `unverifiable`       — verification could not be completed (blocks install,
 *                          but is NOT evidence of tampering).
 * - `failed`             — the bytes are not what the registry published, or a
 *                          present signature did not check out (refuses install).
 *
 * There is deliberately no `verified` / `safe` / `trusted` variant. The whole
 * product of this issue is the distinction between `verified-signature` and
 * `checksum-only`; a single green "verified" verdict would erase it.
 */
export type IntegrityVerdict =
  | {
      readonly kind: 'verified-signature'
      readonly keyId: string
      readonly digest: string
    }
  | { readonly kind: 'checksum-only'; readonly digest: string }
  | { readonly kind: 'unsigned'; readonly digest: string }
  | {
      readonly kind: 'unverifiable'
      readonly reason: 'offline' | 'no-published-digest' | 'no-trust-root'
    }
  | {
      readonly kind: 'failed'
      readonly reason:
        | 'digest-mismatch'
        | 'size-mismatch'
        | 'bad-signature'
        | 'revoked-key'
    }

/**
 * Pinned at the moment of install into Blackfin's own registry (#35). Enables
 * later detection that an installed file was changed on disk — the only way
 * Blackfin can notice post-install tampering. No private key, token or secret
 * is persisted; there is no field capable of holding one.
 */
export interface IInstalledIntegrity {
  /** The hash verified at install time. */
  readonly digest: string
  readonly verdictAtInstall: IntegrityVerdict['kind']
  readonly registryUrl: string
  readonly verifiedAt: number
}

// --- Provenance disclosure (the third word in the issue title) --------------
//
// Provenance says *where an item came from*; integrity says *is it the same
// bit, signed by whom*. This is the disclosure half: parsing a provenance
// attestation into facts, claims, and honest ignorance. It reuses the shape of
// RFC #12 §6 — an author is a *claim* the UI must never present as verified,
// and the *absence* of provenance is a first-class value, never guessed.

/**
 * A raw, UNTRUSTED provenance attestation as it might appear in a registry
 * index. Every field is a stranger's assertion until a fact says otherwise.
 * All fields optional: a record that carries nothing is a valid input, and its
 * emptiness is reported, not invented around.
 */
export interface IProvenanceAttestation {
  /** Where the bytes came from — a URL or git remote. A fact iff Blackfin fetched it. */
  readonly origin?: string | null
  /** The exact commit or tag. The strongest provenance there is, when present. */
  readonly ref?: string | null
  /**
   * CLAIMED by the manifest/catalog. Never verified. Named `claimedAuthor` (not
   * `author`) precisely so the UI cannot forget that Blackfin did not check it.
   */
  readonly claimedAuthor?: string | null
}

/**
 * The disclosure produced from an attestation. `present` lists which facts the
 * record actually carried (with the author always flagged as merely claimed);
 * `absent` states, as a first-class value, that Blackfin does not know. Neither
 * variant asserts safety — provenance narrows *who to blame*, not *whether to
 * trust* (RFC #12 §4.3 B).
 */
export type ProvenanceReport =
  | {
      readonly kind: 'present'
      readonly origin: string | null
      readonly ref: string | null
      /** The author as CLAIMED. `verified` is always `false` — Blackfin cannot check it. */
      readonly claimedAuthor: {
        readonly value: string
        readonly verified: false
      } | null
    }
  | {
      /**
       * Blackfin does not know where this came from and says so, rather than
       * guessing. Fabricated provenance is worse than none.
       */
      readonly kind: 'absent'
    }
