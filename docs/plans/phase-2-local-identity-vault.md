# Phase 2 Plan: Local Identity Vault

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 2, weeks 5–7 (a rough size estimate, not a schedule — see the roadmap's own note on this, carried over from Phase 1's plan). **Deliverable being planned for:** `Root Identity → Service Identity → Credentials → Encrypted Local Vault`, no proprietary server involved.

This is the detailed execution plan for Phase 2, following the same before-code-exists planning discipline Phase 1 used (see [`phase-1-extension-foundation.md`](phase-1-extension-foundation.md), now fully implemented: 7 milestones, 37 unit tests + 1 Playwright e2e test, manually verified in real Chrome, all committed). `docs/roadmap.md`'s Phase 2 section is only 9 flat objective bullets with no milestone breakdown — this plan supplies that breakdown, grounded in [`identity-model.md`](../identity-model.md), [`ADR-010`](../adr/ADR-010-identity-derivation-function.md), [`ADR-011`](../adr/ADR-011-webauthn-metadata-only-mode.md), [`data-model.md`](../data-model.md), [`security-model.md`](../security-model.md), [`threat-model.md`](../threat-model.md), [`biometric-model.md`](../biometric-model.md), and [`research/attestto-teardown.md`](../research/attestto-teardown.md).

Several of those docs left specific design questions explicitly open, to be resolved before Phase 2 locks in its design. This plan resolves all of them, plus one new gap found only by actually tracing the design through rather than taking ADR-010 at face value. Where a research doc's sketch or an earlier doc's phrasing turned out to be wrong or incomplete, this plan says so explicitly (see "Key design decisions" below) rather than quietly re-deriving around it.

---

## Key design decisions

Each numbered decision below that says "new ADR" should get one at implementation time, following the existing ADR template (Status/Context/Decision/Consequences). Current highest is ADR-011, so these are ADR-012, ADR-013, ADR-014 in the order introduced below.

### 1. Vault unlock key: WebAuthn PRF primary, Argon2id-passphrase fallback secondary — **new ADR (ADR-012)**

[`security-model.md`](../security-model.md) flagged this explicitly as "a genuinely open design question, not yet a final decision, and worth resolving explicitly before Phase 2... locks in the vault's unlock path." Attestto's own reason for refusing a passphrase fallback — "a passphrase-derived key is indistinguishable from a passkey-derived one, which would make 'passkey-protected' an unverifiable claim" for their signature-centric product — does not transfer here. This project makes no marketed security claim to any third-party verifier ([`product-vision.md`](../product-vision.md) — a personal, local-first tool). What does transfer is the opposite risk: a hard PRF-or-nothing gate means a single user, on a single machine, with an authenticator that lacks PRF support (or that later fails or gets replaced), is **permanently locked out of their own vault** — no support desk, no account-recovery flow. For a solo local-first tool, that is the worse failure mode.

**Decision:** ship both. WebAuthn PRF stays the primary, recommended path (Attestto's production-validated pattern, ties unlock to the OS-native biometric per [`biometric-model.md`](../biometric-model.md) Model A). A passphrase-derived fallback is added as an explicit, user-chosen secondary path, using the *same* KDF as backup-export (decision 3) so there is exactly one non-native-Web-Crypto KDF in the codebase, not two. The vault's decrypt logic is agnostic to which path produced the AES key — it only ever receives a raw `CryptoKey`, never a marker of how it was obtained.

ADR-012 should record: Context = security-model.md flagged this open, Attestto's no-fallback reasoning doesn't transfer; Decision = PRF primary + Argon2id-passphrase secondary, both producing an AES-256-GCM key of identical shape; Consequences = a passphrase fallback is exactly as offline-brute-forceable as the backup-export file already is (same KDF, same Attacker-D reasoning, no new attacker surface) but the setup UI must make the trade-off explicit (PRF strongly recommended), not present both as equivalent.

### 2. `FixedAppSalt`: generate once via CSPRNG, store unencrypted in `browser.storage.local`, never regenerate

[`ADR-010`](../adr/ADR-010-identity-derivation-function.md) says `FixedAppSalt` is "fixed per installation" but never specifies how it's generated or stored — a genuine gap found during grounding, not previously flagged anywhere. HKDF salts aren't secret (RFC 5869) — the salt's job is uniqueness-per-installation, not confidentiality. Generate 32 random bytes via `crypto.getRandomValues()` at root-identity creation time, store base64-encoded under a dedicated `browser.storage.local` key (`if_vault_salt_v1`), written atomically as part of the same setup flow that creates `RootIdentity` — there must never be a state where a root identity exists without a salt already committed.

**It must never be regenerated after creation.** Regenerating it silently changes every future HKDF output — every future `derive(root, origin)` call would produce a *different* Service Identity than before, with no error. Not a security bug, but a dangerous correctness bug that looks like "my accounts are gone." It must also be included in the backup-export bundle (decision 7 / M7) — restoring the vault on a new device without the *original* salt reproduces `RootSecret` correctly but silently derives the *wrong* Service Identities.

### 3. Backup-export KDF: Argon2id via `@noble/hashes`, reused for the passphrase-unlock fallback too

[`security-model.md`](../security-model.md) already leans Argon2id for backup-export specifically ("remains the right KDF... independent of [the PRF-vs-passphrase] question"). PBKDF2 is native to Web Crypto (zero new dependency) and would be a legitimate zero-dependency choice in isolation — but once Argon2id's dependency cost is *already paid* for backup-export, maintaining PBKDF2 as a second, structurally weaker KDF purely for the passphrase-unlock fallback buys nothing: more code, more tests, weaker offline-brute-force resistance for no benefit.

**Decision:** one KDF — Argon2id via `@noble/hashes/argon2` (exact-pinned, added to `dependencies`, not `devDependencies`, since backup-export ships in the production bundle) — used for both the backup-export key and the passphrase-unlock-fallback key, reusing Attestto's own validated starting parameters (`t=2, m=19456 KiB, p=1`, OWASP 2024 interactive-use recommendation) with distinct fixed `info`/context strings so the two derivations are cryptographically distinct even if a user reuses the same passphrase for both purposes. This is the first crypto *library* dependency in the project — a narrow, single-purpose, already-production-validated exception to "never invent cryptography" (Web Crypto has no native Argon2), the same kind of principled exception [`security-model.md`](../security-model.md) already allows for network calls ("an explicit, auditable exception rather than a default posture").

### 4. Service Identity keys are Ed25519, not ECDSA/P-256 — **new ADR (ADR-014)**

This is the new gap, not in any prior doc: [`ADR-010`](../adr/ADR-010-identity-derivation-function.md) says HKDF output "deterministically seeds a per-origin ECDSA/Ed25519 keypair... via the Web Crypto API." **`crypto.subtle.generateKey()` has no seed parameter for either algorithm** — it is spec'd to use the browser's internal CSPRNG only, by design, precisely to prevent low-entropy or malicious seeding. For ECDSA/P-256, deterministic seeding from a raw scalar isn't achievable through Web Crypto alone either: importing a private JWK generally requires the public coordinates (`x`, `y`) alongside `d`, and Web Crypto exposes no "compute the public point from a private scalar" primitive for NIST curves — doing that by hand is exactly the kind of hand-rolled elliptic-curve math "never invent cryptography" rules out.

Ed25519 is different: per RFC 8032, an Ed25519 private key genuinely *is* a 32-byte seed — the public key and signing behavior are both deterministically derived from that seed by the algorithm's own definition, not by browser-internal randomness. **Decision:** commit to Ed25519 (not ECDSA/P-256) for Service Identity keys. Verify empirically — during M5, not before, mirroring Phase 1's own "confirm the exact API against current docs/behavior at implementation time" discipline (e.g. the M6 `channel: 'chromium'` re-verification) — whether the currently-pinned Chromium's `crypto.subtle.importKey('jwk'|'raw', ..., 'Ed25519', ...)` accepts a private key specified purely by its 32-byte seed. If it does not behave as needed, fall back to `@noble/curves` (same maintainer/audit lineage as `@noble/hashes`, decision 3) for *only* the seed→keypair step, keeping AES-GCM/HKDF/CSPRNG on native Web Crypto everywhere else.

ADR-014 should record: Context = ADR-010 as written isn't literally implementable via Web Crypto's `generateKey()`; Decision = Ed25519 because its private key is definitionally a seed; Consequences = if Web Crypto's own Ed25519 import doesn't support seed-only private-key import in the current browser, `@noble/curves` is used for the seed→keypair step only, as a narrow audited exception, not a departure from "never invent cryptography."

### 5. A three-key hierarchy, made explicit — **new ADR (ADR-013)**

Neither ADR-010 nor [`security-model.md`](../security-model.md) cleanly separates three things that must be three *different* secrets with different lifetimes:

```text
VaultUnlockKey   — derived per-unlock from PRF or passphrase; AES-GCM key that
                   encrypts/decrypts the vault blob; session-cached only,
                   rotatable (changing your unlock method must not touch
                   anything below this line)
      ↓ decrypts
RootSecret        — a CSPRNG-random value generated ONCE at setup, stored
                   encrypted INSIDE the vault blob (protected BY VaultUnlockKey,
                   but not derived from it); the HKDF ikm for every
                   Service Identity derivation (ADR-010); must never change
                   for the lifetime of the vault, independent of how many
                   times the unlock method itself changes
BackupExportKey   — derived per export, from a separate backup passphrase via
                   Argon2id; encrypts only the export bundle; has no
                   relationship to VaultUnlockKey or RootSecret at all
```

If `VaultUnlockKey` and `RootSecret` were conflated (e.g. re-pairing a new passkey silently changed the HKDF `ikm`), every previously-derived Service Identity would become unrecoverable the moment the user changed how they unlock the vault — a severe, easy-to-introduce bug if not stated explicitly up front. This generalizes Attestto's own "device-unlock key ≠ backup key" lesson ([`attestto-teardown.md`](../research/attestto-teardown.md) §8, implication 3) one level further.

ADR-013 should record: Decision = three cryptographically independent keys as diagrammed above; Consequences = changing/re-pairing the unlock method never invalidates derived Service Identities; a stolen backup file is decryptable only with its own passphrase, independent of the live vault's unlock method.

### 6. Pre-unlock UI: existence flag only, no content mirror

Attestto's dual-vault (a plaintext public mirror alongside the encrypted vault) caused real shipped bugs from forgotten mirror syncs ([`attestto-teardown.md`](../research/attestto-teardown.md) §8, implication 2/3). Phase 2 avoids that class of bug entirely rather than building the discipline to avoid it: the popup shows exactly three states — "no vault yet" (setup), "vault locked" (unlock form), "vault unlocked" — and **nothing else pre-unlock**. No "3 service identities exist" summary, no cached counts.

- `vaultInitialized: boolean` lives in `browser.storage.local` (survives restart; answers "has setup ever run," which an absent session key alone can't distinguish from "locked").
- `locked` is never itself persisted — it's derived on every read by checking whether a `VaultUnlockKey` is currently present in `browser.storage.session`, mirroring `background/session/state.ts`'s own "derive, don't duplicate" precedent exactly.

This is a deliberate scope decision: **Phase 2 builds no pre-unlock summary of vault contents**, full stop.

### 7. Scope boundary and storage backend, confirmed

Phase 2 builds the **schema, storage, and encryption** for every tree in [`data-model.md`](../data-model.md) — not the *behavior* later phases layer on top. And: `browser.storage.local` for the whole encrypted blob, not IndexedDB, not yet, despite [`CLAUDE.md`](../../CLAUDE.md)'s stack table naming IndexedDB for "larger structures." Reasoning: the entire `VaultData` tree is one JSON-serializable blob, comfortably within `storage.local`'s quota for a single-user dataset even with dozens of Service Identities and credentials — Attestto ships production users exactly this way (`attestto_ext_vault`, one `storage.local` key). Raw IndexedDB has no native Promise API and would need either a hand-rolled callback wrapper or a new `fake-indexeddb` test-only dependency to be unit-testable at all (Node has no IndexedDB global) — real cost, no present benefit. One storage backend and one write path is also the safer choice per the dual-vault-mirror-drift lesson above. If size ever becomes a real constraint (most plausibly once Phase 4's Privacy Ledger accumulates volume), migrating one blob's storage backend later is a contained, well-motivated change — not something to build speculatively now.

See the full table below for the rest of the scope boundary.

---

## Scope boundary — read this before implementing anything

| Not in Phase 2 | Belongs to |
|---|---|
| Field semantic classification, Identity Firewall interception, consent UI | Phase 3 — Identity Firewall |
| Policy Engine decision logic (auto-allow/alias/ask/deny), Privacy Ledger read/write behavior, "what does this site know about me?" UI | Phase 4 — Privacy Ledger + Policy Engine. Phase 2 creates the `Policies`/`PrivacyLedger` schema trees with empty/default values and encrypts them as part of the vault blob — nothing reads or writes into them meaningfully yet. |
| Per-request biometric authorization ceremony for Level 2/3 sensitive-field release | Phase 5 — Biometric Authorization. Phase 2 only implements Model A's mechanical vault-unlock gate (the WebAuthn PRF/passphrase mechanism itself), not a second, separate per-disclosure biometric re-prompt. |
| Alias-provider API calls (SimpleLogin/addy.io), real `AliasProviderConfig` wiring | Phase 6 — Legacy Web Compatibility. Phase 2 creates the `Aliases`/`AliasProviderConfig` schema, defaulted to `provider: 'none'`, with no outbound network calls. |
| Government/financial safe-mode detection and enforcement | Phase 4 / [`product-vision.md`](../product-vision.md) — consumes `Policies` data Phase 2 only schemas. |
| Full software WebAuthn authenticator custody of *site* passkey private-key material | **Never** in MVP scope, per [ADR-011](../adr/ADR-011-webauthn-metadata-only-mode.md). Phase 2's `Credentials` tree stores only `rp.id`/`credentialId` references for site passkeys, never private keys — see "Resolved conflict" below on why the vault's *own* unlock passkey is a different, first-party credential this rule doesn't apply to. |
| Dynamic-DOM / SPA form re-render detection | Phase 6 |
| Any content-script change at all | N/A — Phase 2 touches only `background/`, `shared/`, `stores/`, and `entrypoints/popup/`. `entrypoints/content.ts` and `content/formDetection.ts` are untouched. |

### Resolved conflict: the vault's own unlock passkey is not an ADR-011 concern

ADR-011 commits this project to never intercepting a *site's* WebAuthn ceremony. Phase 2's WebAuthn use is unrelated: the extension registers its **own**, first-party `navigator.credentials.create()` credential, scoped to the extension's own origin (`chrome-extension://<id>`, exactly the relying-party ID Attestto uses for the identical purpose), purely to gate vault unlock. No site is ever involved, no site's ceremony is touched, and no passkey *reference* for a site is created by this flow. `Credentials` (the per-site tree, reference-only per ADR-011) and "the vault's own unlock credential" (full first-party custody, because we generated it for ourselves) are two unrelated things that happen to both use WebAuthn.

---

## Milestones

Ordered by dependency, not by calendar week.

### M1 — Vault data schema & extended message contract

- `shared/vault-schema.ts` (new) — Zod schemas for the full [`data-model.md`](../data-model.md) tree: `RootIdentitySchema`, `PersonalDataSchema`, `ServiceIdentityRecordSchema`, `CredentialRecordSchema` (password or passkey-reference variant, per ADR-011), `AliasRecordSchema` and `AliasProviderConfigSchema` (schema-only, `provider: 'none'` default), `PolicySchema`/`PrivacyLedgerEntrySchema` (schema-only, empty defaults), combined into `VaultDataSchema` with a `schemaVersion: 1` literal field — cheap to add now, expensive to retrofit, same reasoning already used for `normalizeOrigin`.
- `shared/messages.ts` — extend the existing `ExtensionMessageSchema` discriminated union additively (per its own header comment, which already names two of these) with 12 new message types: `VAULT_STATUS`, `CREATE_ROOT_IDENTITY`, `VAULT_UNLOCK`, `VAULT_LOCK`, `GET_SERVICE_IDENTITY`, `CREATE_SERVICE_IDENTITY`, `GET_PERSONAL_DATA`, `SET_PERSONAL_DATA`, `GET_CREDENTIAL`, `SAVE_CREDENTIAL`, `DELETE_CREDENTIAL`, `EXPORT_VAULT_BACKUP`, `RESTORE_VAULT_BACKUP`. Full payload shapes are specified in each milestone below as that capability is built.
- **Acceptance for M1**: unit tests confirm `VaultDataSchema` accepts a minimal valid tree (all-defaults, no personal data filled in) and rejects a tree missing `schemaVersion`; `ExtensionMessageSchema` accepts and rejects payloads for all 12 new message types exactly as it already does for Phase 1's three.

#### M1 — Implementation (as built)

- **Corrected count: 13 message types, not 12.** This section's own bullet above undercounted by one (`EXPORT_VAULT_BACKUP` and `RESTORE_VAULT_BACKUP` are two types, both already listed). `shared/messages.ts`'s `ExtensionMessageSchema` union now has 16 total members: Phase 1's 3 plus these 13.
- **Credentials and Aliases are nested inside each `ServiceIdentityRecord`, not top-level `VaultData` fields.** `data-model.md`'s own ASCII tree draws them as siblings of `ServiceIdentities`, but its prose bullet and `identity-model.md` both say a Service Identity "holds... credentials, aliases..." — resolved in favor of the prose. The tree diagram is conceptual, not a literal storage layout (it also doesn't nest `PersonalData`'s own sub-fields).
- **`z.record()` needs both a key and a value schema in zod 4.4.3** — `z.record(z.string(), ServiceIdentityRecordSchema)`, confirmed by reading `node_modules/zod/v4/classic/schemas.d.ts` directly, not zod 3's single-argument form.
- **Two invariants were added beyond the original plan, found by `/code-review` and judged cheap enough to fix immediately rather than defer:**
  - `AliasRecordSchema` now `.refine()`s that `providerAliasId` is `null` exactly when `provider` is `'none'` — the field comment already promised this; nothing previously enforced it.
  - `ServiceIdentityRecordSchema.credentials` now `.refine()`s at most one credential per `kind` — `DELETE_CREDENTIAL`'s `{ origin, kind }` payload only unambiguously identifies a credential to remove under this constraint.
  - `Argon2ParamsSchema`'s `t`/`m`/`p` are now `z.number().int().positive()`, not bare `z.number()` — this schema validates an untrusted backup-file boundary (`RESTORE_VAULT_BACKUP`), so malformed KDF parameters should fail at the router, not reach M7's Argon2id call.
  - `VAULT_STATUS`, `VAULT_LOCK`, and `GET_PERSONAL_DATA` now carry `payload: z.object({}).optional()`, matching `GET_SESSION_STATE`'s existing no-payload convention, instead of omitting `payload` entirely — keeps their inferred types consistent with the sibling message a future handler is likely to be copied from.
  - `SET_PERSONAL_DATA`'s payload dropped `PersonalDataSchema.partial()` in favor of plain `PersonalDataSchema` — every field is already `.optional()`, so `.partial()` was a no-op that implied (incorrectly) that some fields were otherwise required.
- **A real gap surfaced at compile time, not in the plan:** `background/router/registry.ts`'s `Registry` type was a total mapped type over every `ExtensionMessage['type']`, so adding 13 message types with no handlers yet (M2-M7's job) broke `pnpm compile`. Fixed by making `Registry` a `Partial<...>`, and `background/router/dispatch.ts`'s `handleRuntimeMessage` now replies `{ ok: false, error: 'NOT_IMPLEMENTED' }` synchronously for any schema-valid message type with no registered handler — a fourth, still-exactly-once reply path alongside validation failure, handler success, and handler rejection.
- **Test coverage**: `tests/unit/shared/vault-schema.test.ts` (new) covers `VaultDataSchema`'s minimal-tree acceptance and missing-`schemaVersion`/wrong-version rejection, `CredentialRecordSchema`'s both variants and invalid-`kind` rejection, `AliasRecordSchema`'s `provider`/`providerAliasId` invariant in both directions, and `ServiceIdentityRecordSchema`'s nested round-trip plus the duplicate-credential-kind rejection. `tests/unit/shared/messages.test.ts` gained one `describe` block per new capability area (vault lifecycle, service identity, personal data, credentials, backup) plus `UnlockInputSchema`'s two variants. `tests/unit/background/router/dispatch.test.ts` gained a case for the new `NOT_IMPLEMENTED` path. Total suite: 82 tests (up from Phase 1's 37), full `pnpm check` green.

### M2 — Crypto primitives, key hierarchy, and `FixedAppSalt` lifecycle

- `background/vault/crypto.ts` — pure functions, Web Crypto API only: `deriveHkdfBits(ikm, salt, info, lengthBits)`, `generateAesGcmKeyFromBits(bits)`, `encryptBlob(key, plaintext) → {iv, ciphertext}` (12-byte random IV per encrypt, matching Attestto's validated pattern), `decryptBlob(key, iv, ciphertext)`, `randomBytes(n)` (CSPRNG wrapper).
- `background/vault/keys.ts` — semantic wrappers implementing the three-key hierarchy (decision 5): `deriveVaultUnlockKey(prfOutputOrPassphraseBits, fixedAppSalt)`, `generateRootSecret()`, `deriveBackupExportKey(passphrase, argon2Salt)`.
- `background/vault/salt.ts` — `getOrCreateFixedAppSalt()`: reads `if_vault_salt_v1` from `browser.storage.local`, generates+persists via CSPRNG on first call, never regenerates on subsequent calls.
- Add `@noble/hashes` (exact-pinned) to `dependencies` for Argon2id — first crypto dependency in the project, justified per decision 3.
- **Design decision locked in**: all `crypto.subtle` usage lives in files under `background/vault/` and `background/identity/`, tested exclusively under Vitest's default `node` environment (real `crypto.subtle`, confirmed working this session — Node ≥19's global `crypto.subtle` is a genuine WebCrypto implementation). This is deliberate, not an accident: `jsdom@30.0.1`'s `window.crypto` implements only `getRandomValues`/`randomUUID` — **`crypto.subtle` is `undefined` under jsdom**, confirmed empirically this session. No file in this phase needs both DOM and `crypto.subtle` in the same test run, because the WebAuthn ceremony (a DOM-only concern, M4, lives in `stores/vault.store.ts`) only ever produces opaque bytes forwarded to background over a message, and never calls `crypto.subtle` itself.
- **Acceptance for M2**: `deriveHkdfBits` matches known RFC 5869 HKDF-SHA256 test vectors; `encryptBlob`/`decryptBlob` round-trip correctly and a single flipped ciphertext byte causes decryption to reject (AES-GCM's authentication tag doing its job); `getOrCreateFixedAppSalt` returns the identical value across repeated calls and generates a fresh one only when storage is empty.

#### M2 — Implementation (as built)

- **`deriveVaultUnlockKey` takes the existing `UnlockInput` discriminated union directly** (`shared/messages.ts`, built in M1), not the shorthand `prfOutputOrPassphraseBits` blob written above — reuses an existing type instead of inventing an ambiguous parameter shape.
- **Argon2id calls use `argon2idAsync`, not the blocking sync `argon2id`** — confirmed by reading `@noble/hashes@2.4.0`'s real source: the async variant yields periodically instead of blocking the MV3 service worker's single JS thread for the full memory-hard computation.
- **Domain separation between the passphrase-unlock and backup-export Argon2id derivations uses the library's own `personalization` option field** (confirmed to exist in `ArgonOpts`), not manual byte concatenation as an earlier draft of this plan assumed.
- **A real gap found during planning, fixed before implementation**: Argon2 cost parameters (`t`/`m`/`p`) would have been hardcoded inside `keys.ts`. `VaultBackupBundleSchema` already solves exactly this problem for backup-export by storing `kdfParams` inline in every bundle; the passphrase-unlock path had no equivalent, meaning a future retuning of the defaults would have silently stranded every existing passphrase-only vault. Fixed by:
  - Moving `Argon2ParamsSchema`/`Argon2Params` from `shared/messages.ts` into `shared/vault-schema.ts` (avoids a circular import, since `vault-schema.ts` must not import from `messages.ts`, which already imports several schemas *from* `vault-schema.ts`).
  - Adding an optional `passphraseArgon2Params: Argon2ParamsSchema.optional()` field to `RootIdentitySchema`, to be populated by M4 when passphrase-unlock is configured.
  - Giving `deriveVaultUnlockKey` and `deriveBackupExportKey` an explicit `argon2Params` parameter defaulting to an exported `DEFAULT_ARGON2_PARAMS` constant, instead of hardcoding `t`/`m`/`p` inline — this also lets tests use cheap params (`{t:1, m:8, p:1}`) instead of running the real ~19MB memory-hard computation dozens of times per `pnpm check`.
- **New `shared/bytes.ts`** (not named in the original bullet list above) — `bytesToBase64`/`base64ToBytes`, needed because `FixedAppSalt` persists as a base64 string (matching the project's established `xxxB64` convention) and M4's popup-side setup UI will need the same codec for PRF bytes. Encodes in fixed-size chunks (not a byte-by-byte loop, and not one whole-buffer spread), since spread on a large `Uint8Array` throws `RangeError` past the ~65536-argument engine limit.
- **`getOrCreateFixedAppSalt` uses a lightweight in-flight-promise memo**, not `background/session/state.ts`'s full serializing write-queue — confirmed appropriate since that queue solves repeated read-modify-write cycles for a value that changes every call, a different problem from a value generated at most once, ever.
- **TypeScript 5.9's stricter `BufferSource` typing** (a `Uint8Array` parameter/return annotation defaults its buffer generic to `ArrayBufferLike`, but Web Crypto's `BufferSource` requires exactly `ArrayBuffer`) required `as BufferSource` casts at the six Web Crypto call sites inside `background/vault/crypto.ts`. This is a TS-only concession, not a runtime one — every `Uint8Array` this codebase constructs is genuinely `ArrayBuffer`-backed — confined to that one file rather than propagating a stricter generic through every function signature in the codebase.
- **`@noble/hashes@2.4.0` confirmed pure JS/TS, no WASM** (read the real GitHub source directly) — `pnpm build`'s output `manifest.json` has no `content_security_policy` field at all, resolving the "check before M2 is called done" item with a real build, not just a documentation read.
- **ADR-012** (vault unlock key: PRF primary + Argon2id-passphrase secondary) and **ADR-013** (three-key hierarchy) are written and accepted. ADR-014 (Ed25519 vs. ECDSA) stays deferred to M5 as planned.
- **Two real findings from `/code-review`, both fixed**:
  - `Argon2ParamsSchema` had no upper bound on `t`/`m`/`p`, only a lower one. Since this schema validates `VaultBackupBundle.kdfParams` at `RESTORE_VAULT_BACKUP`'s untrusted-input boundary, a corrupted or malicious backup file could force an effectively unbounded Argon2id computation (`@noble/hashes`'s own `maxmem` default caps a runaway `m`, but nothing capped `t` or `p`). Fixed with generous-but-finite ceilings (`t<=10`, `m<=1_048_576` KiB, `p<=16`) relative to `DEFAULT_ARGON2_PARAMS` (`t=2, m=19456, p=1`).
  - `shared/bytes.ts`'s `bytesToBase64` encoded one byte per loop iteration via `String.fromCharCode` + string concatenation — correct, but far slower than necessary for the multi-KB/MB encrypted vault blobs this codec exists to carry. Fixed with chunked encoding (`String.fromCharCode(...chunk)` over 8192-byte `subarray` slices), which stays safely under the spread-argument call-stack limit while batching many bytes per call instead of one.
- **Test coverage**: `tests/unit/shared/bytes.test.ts` (round-trip, large-buffer, chunk-boundary, edge-length, known-vector cases), `tests/unit/background/vault/crypto.test.ts` (RFC 5869 vector, AES-GCM round-trip/tamper/wrong-key rejection, `randomBytes` sanity), `tests/unit/background/vault/keys.test.ts` (functional round-trip and determinism checks per `unlockMethod`, salt-sensitivity, `DEFAULT_ARGON2_PARAMS` end-to-end, and the specific decision-3 invariant that the passphrase-unlock and backup-export paths produce different keys from the same passphrase+salt), `tests/unit/background/vault/salt.test.ts` (generate-once, repeated-call stability, concurrent-call de-duplication via a spied `browser.storage.local.set`), plus extensions to `tests/unit/shared/vault-schema.test.ts` (`RootIdentitySchema`'s new optional field) and `tests/unit/shared/messages.test.ts` (Argon2 parameter ceiling rejection). Total suite: 116 tests (up from M1's 82), full `pnpm check` and `pnpm build` green.

### M3 — Encrypted vault storage module

- `background/vault/storage.ts` — the storage-owning module, mirroring `background/session/state.ts`'s established shape exactly, extended from `.session` to `.local` and from plaintext to encrypted:
  - `readVaultData(): Promise<VaultData>` — reads the encrypted blob from `browser.storage.local`, decrypts with the currently session-cached `VaultUnlockKey`, throws a typed `VaultLockedError` if no key is cached.
  - `updateVaultData(mutator: (draft: VaultData) => VaultData): Promise<void>` — **the one function allowed to write the vault blob.** Every capability module (M5/M6/M7) funnels writes through this, never writing `browser.storage.local` directly — the direct, structural fix for the Attestto dual-vault-drift lesson: one write path, not a discipline to remember.
  - `getCachedUnlockKey()`/`setCachedUnlockKey()`/`clearCachedUnlockKey()` — thin wrappers over `browser.storage.session` for the ephemeral `VaultUnlockKey`.
  - A single-writer promise queue serializing calls to `updateVaultData`, generalizing `session/state.ts`'s existing queue pattern from "per-origin map mutation" to "whole-vault-blob mutation."
- `background/vault/unlock.ts` — `requireUnlocked(): Promise<VaultData>` guard used by every handler that needs decrypted content; returns a `{ok:false, error:'VAULT_LOCKED'}`-shaped rejection otherwise.
- **Acceptance for M3**: a round-trip test (`updateVaultData` then `readVaultData`) confirms the written mutation is visible; `readVaultData` throws when no unlock key is cached; two concurrent `updateVaultData` calls mutating different sub-trees both survive (mirrors `session/state.ts`'s own concurrent-write test); `fakeBrowser.storage.local` confirmed empirically this session to be exactly as fully-implemented as `.session` — no new test infrastructure needed here.

### M4 — Root Identity: setup, lock/unlock

- `background/vault/setup.ts` — `createRootIdentity(unlockInput)`: generates `RootSecret` (M2), derives `VaultUnlockKey` from either PRF output or passphrase (decision 1), writes the initial `VaultData` (empty `PersonalData`, empty trees, `RootIdentity` populated) via `updateVaultData`, sets `vaultInitialized: true` in `browser.storage.local`, caches the unlock key.
- `background/vault/handler.ts` — `handleVaultStatus`, `handleCreateRootIdentity`, `handleVaultUnlock`, `handleVaultLock`.
- `background/router/registry.ts` — add rows for `VAULT_STATUS`, `CREATE_ROOT_IDENTITY`, `VAULT_UNLOCK`, `VAULT_LOCK` under the already-reserved `'vault'` capability. No change to the `Capability` type itself.
- `stores/vault.store.ts` (new, top-level, sibling of `stores/session.store.ts`) — owns the **only** place `navigator.credentials.create()`/`.get()` with the `prf` extension is called, since WebAuthn requires a document context (background service workers cannot call it — a real, previously-shipped Attestto constraint, [`attestto-teardown.md`](../research/attestto-teardown.md) §8.7). Only the resulting PRF bytes (or, for the fallback, the raw passphrase) cross the message boundary to background — the store itself never touches `crypto.subtle`.
- `entrypoints/popup/App.vue` — replaces Phase 1's inert "Vault — not yet implemented" placeholder with three real states: setup form (choose PRF or passphrase), unlock form, unlocked indicator.
- **Message payloads**: `CREATE_ROOT_IDENTITY: { unlockMethod: 'passkey', prfOutputB64, credentialId, rpId } | { unlockMethod: 'passphrase', passphrase }`; `VAULT_UNLOCK` mirrors the same union; `VAULT_STATUS` response: `{ initialized: boolean, locked: boolean }`.
- **A real WebAuthn footgun to design around from day one** ([`attestto-teardown.md`](../research/attestto-teardown.md) §8.4): `create()`/registration reports `prf.enabled: true` but never returns the actual secret — only a subsequent `get()`/assertion returns `results.first`. `stores/vault.store.ts`'s setup flow must always follow registration with an immediate assertion to actually obtain the PRF bytes, never conclude "unsupported" from the registration response alone.
- **Acceptance for M4**: a fixture-PRF-bytes round trip (mock `navigator.credentials`, real HKDF/AES downstream) confirms setup → lock → unlock with the same fixture bytes decrypts identically; the passphrase-fallback path round-trips independently; `VAULT_STATUS` correctly reports `uninitialized → initialized+locked → unlocked → locked` across the actual state transitions, using only `browser.storage.local`/`.session` mocks (no crypto needed for this state-machine layer).

### M5 — Service Identity derivation (ADR-010, concretely)

- `background/identity/derive.ts` — `deriveServiceIdentityKeypair(rootSecret: ArrayBuffer, origin: CanonicalOrigin): Promise<CryptoKeyPair>`: `normalizeOrigin(origin)` (reused directly from `shared/origin.ts`, per ADR-010's own instruction) → UTF-8 bytes as HKDF `info` → `deriveHkdfBits(rootSecret, fixedAppSalt, infoBytes, 256)` → import as an Ed25519 private key (decision 4 — verify Web Crypto's seed-only import empirically here; fall back to `@noble/curves` only if it doesn't behave as needed).
- `background/identity/storage.ts` — reads/writes the `ServiceIdentities` sub-tree via `vault/storage.ts`'s `readVaultData`/`updateVaultData`, not a separate storage path.
- `background/identity/handler.ts` — `handleGetServiceIdentity` (read-only, returns `null` if not yet created), `handleCreateServiceIdentity` (idempotent create).
- `background/router/registry.ts` — add rows for `GET_SERVICE_IDENTITY`, `CREATE_SERVICE_IDENTITY` under the already-reserved `'identity'` capability.
- **Acceptance for M5**: deriving twice from the same `RootSecret` + origin produces byte-identical keypairs (determinism — the core property ADR-010 exists for); two different origins produce visibly different keys; `GET_SERVICE_IDENTITY` returns `null` before creation and the same values after, across a simulated storage read.

### M6 — Credentials + Personal Data storage

- `background/vault/credentials/storage.ts`, `handler.ts` — `handleGetCredential`, `handleSaveCredential`, `handleDeleteCredential`, keyed by `CanonicalOrigin`. `CredentialRecord` is either a password entry (real secret, protected only by whole-blob AES-GCM, no field-level encryption — matching Attestto's own validated "not field-level" choice, and consistent with Phase 5's biometric gate being an application-layer consent event, not a separate storage-layer key) or a passkey-reference entry (`rp.id` + `credentialId` only, per ADR-011 — never private key material).
- `background/vault/personalData/storage.ts`, `handler.ts` — `handleGetPersonalData`, `handleSetPersonalData` (patch-style update).
- `background/router/registry.ts` — add rows for `GET_CREDENTIAL`, `SAVE_CREDENTIAL`, `DELETE_CREDENTIAL`, `GET_PERSONAL_DATA`, `SET_PERSONAL_DATA`, all under `'vault'`.
- **Acceptance for M6**: save/get/delete round-trips for a credential at a given origin; setting personal data twice (a patch, not a full overwrite) preserves fields not included in the second patch; both capabilities correctly reject with `VAULT_LOCKED` when no unlock key is cached, via the shared `requireUnlocked()` guard from M3.

### M7 — Secure export / local backup

- `background/vault/export.ts` — `exportVaultBackup(backupPassphrase)`: derives `BackupExportKey` via Argon2id (M2/decision 3) with a fresh random Argon2 salt, encrypts a bundle containing **both** the full `VaultData` **and** the current `FixedAppSalt` together (per decision 2 — omitting the salt is the specific, easy-to-miss bug that would silently re-derive wrong Service Identities on restore) — bundle format: `{ formatVersion: 1, kdf: 'argon2id', kdfParams, argon2Salt, iv, ciphertext }`, JSON-serialized.
  - `restoreVaultBackup(fileContents, backupPassphrase, newUnlockInput)`: decrypts the bundle, then runs the *same* setup path as M4's `createRootIdentity` but seeded with the restored `VaultData`/`FixedAppSalt` instead of freshly generated ones, and a **newly chosen** unlock method on this device (the old device's `VaultUnlockKey` is never portable — that's the point of the three-key hierarchy, decision 5).
- `background/vault/handler.ts` — `handleExportVaultBackup`, `handleRestoreVaultBackup`.
- `background/router/registry.ts` — add rows for `EXPORT_VAULT_BACKUP`, `RESTORE_VAULT_BACKUP` under `'vault'`.
- `stores/vault.store.ts` / `entrypoints/popup/App.vue` — an "Export backup" action (triggers a file download of the bundle) and a "Restore from backup" flow (file input + backup passphrase + new-unlock-method setup, reusing M4's setup UI).
- **Acceptance for M7**: export → corrupt one byte of `ciphertext` → import fails cleanly (AES-GCM tag rejection, not a silent garbage decrypt); export → restore into a simulated fresh vault → `GET_SERVICE_IDENTITY` for a previously-derived origin returns the **exact same** keypair as before export — the concrete test proving `FixedAppSalt` carried correctly through the bundle, not just that the bundle round-trips at all.

### M8 — Test consolidation + Playwright vault e2e

- Consolidate the crypto-vs-DOM environment split from M2 into an explicit rule documented in `vitest.config.ts`'s own comments: crypto-touching files stay on the default `node` environment; only `stores/vault.store.ts`'s WebAuthn-mocking tests opt into `// @vitest-environment jsdom`, and never call real `crypto.subtle`.
- `tests/e2e/vaultLifecycle.test.ts` (new, extends Phase 1's Playwright fixture pattern) — launches the real build, drives the popup UI through setup → lock → (force a real service-worker restart, same manual-becomes-automated technique as Phase 1's M6/M7) → unlock → confirms a Service Identity survives intact.
- **Acceptance for M8**: the full Vitest suite passes with the environment split holding (no file needs both jsdom and real `crypto.subtle`); the Playwright vault-lifecycle test passes 5/5 consecutive runs, matching Phase 1's own flakiness bar.

### M9 — Manual acceptance pass

Mirrors Phase 1's M7 exactly, but exercising Phase 2's crypto instead of session storage — run against the real production build, in real Chrome, with a real platform authenticator:

- [ ] Setup with a real PRF-capable passkey succeeds; the popup shows "unlocked."
- [ ] Locking, then terminating the service worker (`chrome://serviceworker-internals/`, same technique Phase 1's M7 validated), then reopening the popup shows "locked" — not "uninitialized" and not a crash — proving `vaultInitialized` (persistent) and the unlock-key cache (session-only, correctly cleared by the restart) are tracked separately as designed.
- [ ] Unlocking again with the same passkey decrypts the same `PersonalData`/Service Identities set up earlier.
- [ ] Setting up a second profile with a passphrase-only fallback (no PRF) succeeds and unlocks correctly — proving the fallback path isn't just unit-tested fiction.
- [ ] Export a backup, then restore it into a fresh profile with a *new* unlock method — the restored profile's `GET_SERVICE_IDENTITY` for a known origin returns the identical key as the original profile.
- [ ] Every "Data" and "Recovery" question in [`threat-model.md`](../threat-model.md)'s security-review checklist has a concrete, stated answer for this phase's design specifically (this is also the Phase-3 gate below — doing it here first is the actual work; the gate just confirms it happened).

---

## Directory tree (target state at the end of Phase 2)

```text
identity-firewall-ext/
├── background/
│   ├── router/
│   │   └── registry.ts             # + rows for 12 new message types, 'vault'/'identity' capabilities filled in
│   ├── vault/
│   │   ├── crypto.ts                # HKDF-SHA256, AES-256-GCM, CSPRNG -- Web Crypto only
│   │   ├── keys.ts                  # VaultUnlockKey / RootSecret / BackupExportKey (the three-key hierarchy)
│   │   ├── salt.ts                  # FixedAppSalt generate-once/read
│   │   ├── storage.ts               # readVaultData/updateVaultData -- the ONE write path
│   │   ├── setup.ts                 # createRootIdentity()
│   │   ├── unlock.ts                # unlockVault()/lockVault()/requireUnlocked()
│   │   ├── export.ts                # backup export/import, Argon2id
│   │   ├── handler.ts               # VAULT_STATUS, CREATE_ROOT_IDENTITY, VAULT_UNLOCK, VAULT_LOCK, EXPORT/RESTORE
│   │   ├── credentials/
│   │   │   ├── storage.ts
│   │   │   └── handler.ts
│   │   └── personalData/
│   │       ├── storage.ts
│   │       └── handler.ts
│   └── identity/
│       ├── derive.ts                # ADR-010, Ed25519
│       ├── storage.ts
│       └── handler.ts
├── shared/
│   ├── messages.ts                  # + 12 new message types, additive
│   └── vault-schema.ts              # new -- the full data-model.md tree as Zod
├── stores/
│   └── vault.store.ts               # new -- the ONLY module calling navigator.credentials
├── entrypoints/popup/App.vue        # extended -- real setup/unlock/backup UI, replaces Phase 1's placeholder
├── tests/
│   ├── unit/background/vault/       # new
│   ├── unit/background/identity/    # new
│   └── e2e/vaultLifecycle.test.ts   # new
└── package.json                     # + @noble/hashes (dependencies), pinned exact version
```

No changes to `entrypoints/content.ts`, `content/formDetection.ts`, `background/formDetection/`, or `background/session/` — Phase 2 is additive only, per the scope boundary above.

---

## Open questions to confirm at implementation time, not before

The six questions this plan started with (unlock mechanism, `FixedAppSalt`, backup KDF, pre-unlock UI, Credentials/Aliases scope, and the Phase-3 gate below) all now have a concrete recommendation above — nothing from that original list is left open. These are new, narrower, implementation-time verifications that surfaced while designing the resolutions:

- **Ed25519 seed-only private-key import**: verify against the currently-installed Chromium's actual `crypto.subtle.importKey` behavior for `'Ed25519'` (landed relatively recently in Chromium) whether a bare 32-byte seed is accepted without independently-supplied public coordinates. If not, fall back to `@noble/curves` for the seed→keypair step only (M5).
- **Playwright + WebAuthn virtual authenticator + PRF extension support**: M8's e2e test needs a CDP virtual authenticator (`WebAuthn.enable`/`addVirtualAuthenticator`) that supports the `prf` extension specifically — confirm this against Playwright's and Chromium's current docs before committing to it as the e2e mechanism, mirroring Phase 1's own "`channel: 'chromium'` was re-verified against current docs, not assumed" discipline. If virtual-authenticator PRF support isn't reliable, cover the PRF path only via M9's manual pass and exercise the passphrase-fallback path (no WebAuthn simulation needed) in Playwright instead.
- **TypeScript's bundled DOM lib and the `prf` extension type**: confirm the pinned TypeScript version's `lib.dom.d.ts` includes `AuthenticationExtensionsClientInputs.prf`/`...ClientOutputs.prf`; add a narrow local type augmentation in `stores/vault.store.ts` if not, matching Phase 1's own "a real TypeScript finding" precedent (M5's `fakeBrowser.runtime.sendMessage` overload issue).
- **Whether `@noble/hashes`'s Argon2id build works unmodified under WXT's bundler/MV3 service-worker context** (WASM vs. pure-JS implementation, CSP implications for `wasm-unsafe-eval` if a WASM variant is pulled in) — check which build `@noble/hashes/argon2` ships and whether it needs a manifest CSP addition, before M2 is called done.
- **Exact popup UI real estate for the WebAuthn ceremony** (toolbar popup vs. a dedicated setup page opened in a new tab) — Attestto uses a separate `approval.html` window for its consent flows but its own vault unlock happens directly in the toolbar popup; confirm the toolbar popup's default WXT dimensions are workable for a setup form with method choice, or add a dedicated `entrypoints/setup.html` page if not. Low-risk either way, doesn't block earlier milestones.

---

## Gate to start Phase 3

Phase 1 shipped without a "Gate to start Phase 2" and that was fine — an extension that detects forms carries no security consequence if subtly wrong. Phase 2's output is different: it's the encryption/key-management layer every later phase's security claims rest on directly. Phase 3 starts handing real credentials and personal data to actual third-party sites; if the vault's derivation or encryption is subtly wrong, every site the user ever authorizes inherits that flaw silently. This is the same asymmetry that justified Phase 0's own gate before any code existed ([`roadmap.md`](../roadmap.md)'s "Gate to start Phase 1") — worth one more explicit checkpoint here.

Only move on to Phase 3 once every "Data" and "Recovery" question in [`threat-model.md`](../threat-model.md)'s security review checklist has a concrete, written answer for the vault specifically — not a generic answer, the actual one:

```text
DATA
 - Where does the data live?            -> browser.storage.local, one encrypted blob
 - Is it encrypted?                     -> AES-256-GCM, whole-blob, 12-byte random IV
 - Who holds the keys?                  -> the user, via PRF or passphrase; never persisted as itself
 - What leaves the device?              -> nothing, until Phase 3 exists

RECOVERY
 - What happens if the device is lost?  -> backup export/restore (M7), or total loss without a backup
 - Does a backup exist?                 -> yes, user-triggered, Argon2id-encrypted
 - Who can recover the identity/vault?  -> whoever holds the backup file AND its passphrase
 - Does the backup contain private keys? -> yes (the whole VaultData, including RootSecret) --
                                            say this plainly, don't gloss over it
```

plus one concrete, hands-on proof (M9) that a real service-worker restart never exposes plaintext and never silently loses `vaultInitialized` state — the Phase 2 equivalent of Phase 1's M7 "terminate the service worker and reopen the popup" centerpiece test.

---

## What "done" means for Phase 2

All of M1–M9 pass, and the result is a vault that survives a real device restart and a real service-worker restart with zero plaintext ever touching persistent storage; a Root Identity that deterministically re-derives the exact same Service Identity for the same origin every time, on this device or a restored one; a documented, justified answer (via ADR-012/013/014) to every open cryptographic design question this phase inherited; and every later phase's data trees (Aliases, Policies, Privacy Ledger) already shaped and encrypted, with none of their behavior built early.
