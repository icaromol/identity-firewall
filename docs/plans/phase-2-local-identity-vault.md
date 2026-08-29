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

- `locked` is never itself persisted — it's derived on every read by checking whether a `VaultUnlockKey` is currently present in `browser.storage.session`, mirroring `background/session/state.ts`'s own "derive, don't duplicate" precedent exactly.
- **"initialized" is derived the same way, not tracked by a separate flag** (corrected during M3, superseding this decision's original text, which proposed a standalone `vaultInitialized: boolean` in `browser.storage.local`): `background/vault/storage.ts`'s `vaultBlobExists()` already has to know definitively whether the encrypted blob exists, for its own `initializeVaultData`/`readVaultData` error cases. A separate, independently-written `vaultInitialized` flag would be a second, non-atomically-updated source of truth for the same question — exactly the drift risk this decision's own opening paragraph (Attestto's dual-vault mirror) warns against. M4's `VAULT_STATUS` handler should call `vaultBlobExists()` directly.

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

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

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

#### M3 — Implementation (as built)

- **A `CryptoKey` object cannot survive a `browser.storage.session` round-trip.** Verified empirically (a `crypto.subtle`-imported `CryptoKey` written via `fakeBrowser.storage.session.set()` reads back as `{}`) and by reading the mock's own source, which implements a deliberate `JSON.parse(JSON.stringify(...))` round-trip specifically to replicate real `chrome.storage`'s documented "JSON-serializable values only" contract — a `CryptoKey`'s properties are WebIDL prototype accessors, not own-enumerable data, so this isn't a mock quirk, it reproduces a real platform constraint. This means `getCachedUnlockKey`/`setCachedUnlockKey` cache raw derived key **bits** (base64-encoded), never a `CryptoKey` object, minting a fresh non-extractable `CryptoKey` via `generateAesGcmKeyFromBits` on every read. It required changing `background/vault/keys.ts`'s `deriveVaultUnlockKey` return type from `Promise<CryptoKey>` to `Promise<Uint8Array>` (a minimal diff — both branches already produced `bits` right before the removed final call), and updating `tests/unit/background/vault/keys.test.ts` accordingly. `deriveBackupExportKey` is unchanged (M7, no storage round-trip needed).
- **`RootIdentitySchema.passphraseArgon2Params` (M2's own fix for "Argon2 params must be versioned per-vault") was placed inside the encrypted blob — a chicken-and-egg bug**, since the passphrase-unlock derivation needs to read it before it can derive the key that decrypts that very blob. Removed from `shared/vault-schema.ts`; now recorded unencrypted in `browser.storage.local` via `storage.ts`'s `getPassphraseArgon2Params`/`setPassphraseArgon2Params` — the same justification already used for `FixedAppSalt`, precedented by `VaultBackupBundleSchema.kdfParams` already sitting outside the ciphertext in backup files for the identical reason. **ADR-012 (Accepted) is amended** to reflect both this correction and the bits-not-CryptoKey caching mechanism, rather than silently drifting from what it originally committed to.
- **`initializeVaultData` is a separate function from `updateVaultData`**, despite M4's own plan bullet (below) describing initial vault creation as going "via `updateVaultData`." `updateVaultData`'s mutator contract requires a full, already-valid `VaultData` as input, but `RootIdentitySchema.rootSecretB64` is non-optional, so there's no valid placeholder "draft" a first-ever call could hand a mutator — and treating "no blob yet" the same as "blob exists but locked" risks those two states someday being conflated, silently reinitializing a real vault under some future refactor. Both funnel through one private `persistVaultData()` call site, so "one write path" still means one function, not just one name.
- **Decision 6 amended**: the separate `vaultInitialized: boolean` flag it originally proposed is dropped in favor of `storage.ts`'s `vaultBlobExists()`, applying the same "derive, don't duplicate" principle decision 6 already applies to `locked` — see decision 6's own text above for the full reasoning (found during M3's design, before M4 could build the redundant flag).
- **Error classes set `.message` to the literal code string** (`VaultLockedError` → `'VAULT_LOCKED'`, `VaultNotInitializedError` → `'VAULT_NOT_INITIALIZED'`, `VaultAlreadyInitializedError` → `'VAULT_ALREADY_INITIALIZED'`, `PassphraseArgon2ParamsCorruptedError` → `'PASSPHRASE_ARGON2_PARAMS_CORRUPTED'`), matching `background/router/dispatch.ts`'s existing `err instanceof Error ? err.message : String(err)` convention exactly — there's no separate code-mapping anywhere in the router, so this is the path of least surprise for M4+'s handlers.
- **`unlock.ts`'s `requireUnlocked` is an alias for `storage.ts`'s `readVaultData`**, not a second implementation — both were originally the identical three-line "get cached key, throw if absent, decrypt" guard defined independently in two files, a real `/code-review` finding (divergence risk if one copy were ever edited without the other).
- **Three more `/code-review` findings, all fixed**: `getPassphraseArgon2Params` now distinguishes "never configured" (returns `undefined`) from "stored but fails schema validation" (throws `PassphraseArgon2ParamsCorruptedError`) — silently falling back to `DEFAULT_ARGON2_PARAMS` on corrupted params would derive the wrong key from a *correct* passphrase, indistinguishable from the user mistyping it. `getCachedUnlockKey` now catches a malformed-cached-bits failure (wrong length) and returns `null` rather than letting a raw WebCrypto exception escape, keeping every caller's error handling to the single `VaultLockedError` contract. `unlockVault` now reads `FixedAppSalt` and the passphrase KDF params concurrently via `Promise.all` rather than two sequential `browser.storage.local` round-trips before the Argon2id derivation even starts.
- **Test coverage**: `tests/unit/background/vault/storage.test.ts` (new) covers `vaultBlobExists`, cache set/get/clear plus the malformed-bits case, `initializeVaultData`/`readVaultData`/`updateVaultData` round-trips and all three typed-error cases, the concurrent-write survival case (mirroring `session/state.test.ts`'s own style, no spy), a schema-invalid-mutator rejection, and `getPassphraseArgon2Params`/`setPassphraseArgon2Params` including the corrupted-value case. `tests/unit/background/vault/unlock.test.ts` (new) covers both `unlockMethod` branches end to end, a wrong-passphrase attempt that leaves no cached key behind, the not-initialized case, `lockVault`, and a vault configured with non-default `passphraseArgon2Params` unlocking correctly (the chicken-and-egg fix, tested for real). Total suite: 137 tests (up from M2's 116), full `pnpm check` and `pnpm build` green.

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

### M4 — Root Identity: setup, lock/unlock

- `background/vault/setup.ts` — `createRootIdentity(unlockInput)`: generates `RootSecret` (M2), derives `VaultUnlockKey` from either PRF output or passphrase (decision 1), writes the initial `VaultData` (empty `PersonalData`, empty trees, `RootIdentity` populated) via `initializeVaultData` (not `updateVaultData` — see M3's own correction above; `updateVaultData`'s mutator contract can't represent "no blob yet"), caches the unlock key. No `vaultInitialized` flag is set (dropped per decision 6's M3 amendment) — initialization state is derived from `vaultBlobExists()`.
- `background/vault/handler.ts` — `handleVaultStatus`, `handleCreateRootIdentity`, `handleVaultUnlock`, `handleVaultLock`.
- `background/router/registry.ts` — add rows for `VAULT_STATUS`, `CREATE_ROOT_IDENTITY`, `VAULT_UNLOCK`, `VAULT_LOCK` under the already-reserved `'vault'` capability. No change to the `Capability` type itself.
- `stores/vault.store.ts` (new, top-level, sibling of `stores/session.store.ts`) — owns the **only** place `navigator.credentials.create()`/`.get()` with the `prf` extension is called, since WebAuthn requires a document context (background service workers cannot call it — a real, previously-shipped Attestto constraint, [`attestto-teardown.md`](../research/attestto-teardown.md) §8.7). Only the resulting PRF bytes (or, for the fallback, the raw passphrase) cross the message boundary to background — the store itself never touches `crypto.subtle`.
- `entrypoints/popup/App.vue` — replaces Phase 1's inert "Vault — not yet implemented" placeholder with three real states: setup form (choose PRF or passphrase), unlock form, unlocked indicator.
- **Message payloads**: `CREATE_ROOT_IDENTITY: { unlockMethod: 'passkey', prfOutputB64, credentialId, rpId } | { unlockMethod: 'passphrase', passphrase }`; `VAULT_UNLOCK` mirrors the same union; `VAULT_STATUS` response: `{ initialized: boolean, locked: boolean }`.
- **A real WebAuthn footgun to design around from day one** ([`attestto-teardown.md`](../research/attestto-teardown.md) §8.4): `create()`/registration reports `prf.enabled: true` but never returns the actual secret — only a subsequent `get()`/assertion returns `results.first`. `stores/vault.store.ts`'s setup flow must always follow registration with an immediate assertion to actually obtain the PRF bytes, never conclude "unsupported" from the registration response alone.
- **Chrome/Chromium only for the passkey path.** Firefox extensions currently have no equivalent of Chrome's zero-`host_permissions` own-origin `rp.id` claim, and a live Firefox bug closes the WebExtension popup the instant a WebAuthn prompt appears. Firefox users are expected to use the passphrase fallback until this is revisited — matches Phase 1's own `channel: 'chromium'` dev/e2e scoping.
- **Acceptance for M4**: a fixture-PRF-bytes round trip (mock `navigator.credentials`, real HKDF/AES downstream) confirms setup → lock → unlock with the same fixture bytes decrypts identically; the passphrase-fallback path round-trips independently; `VAULT_STATUS` correctly reports `uninitialized → initialized+locked → unlocked → locked` across the actual state transitions, using only `browser.storage.local`/`.session` mocks (no crypto needed for this state-machine layer).

#### M4 — Implementation (as built)

- **A real gap closed, not in the original bullet list**: the popup had no way to know which unlock method a locked vault was configured with. Added `configuredUnlockMethod`/`passkeyCredentialId` to `VAULT_STATUS`'s response (`storage.ts`'s `getConfiguredUnlockMethod`/`getPasskeyCredentialId`, written unconditionally at setup), so the unlock form shows the right button instead of guess-and-check. `undefined` falls back to showing both — graceful degradation, not an error.
- **Passkey unlock uses a persisted `credentialId` + explicit `allowCredentials`**, not discoverable-credential resolution with an empty `allowCredentials` — the latter is unverified for extension-scoped `rp.id` values, and Attestto's own shipped code went the persisted-`credentialId` route for the identical ceremony. `shared/bytes.ts` gained `base64UrlToBytes` (WebAuthn's `PublicKeyCredential.id` is base64url per spec, not the standard base64 the rest of the codebase's `xxxB64` fields use).
- **The extension's own `rp.id`/`rpId` is left out of every WebAuthn call entirely**, not manually constructed as `chrome-extension://${id}` — confirmed (Chrome team W3C mailing list; MDN) that omitting it lets the browser default to exactly that value, avoiding any risk of a subtly-wrong manual format.
- **`createRootIdentity` was refactored into a thin wrapper over an exported `persistNewVault(vaultData, unlockInput)`**, so M7's `restoreVaultBackup` (which the macro plan says reuses "the same setup path... seeded with the restored `VaultData`") has something real to call instead of duplicating setup's tail end.
- **A real `/code-review` finding, fixed**: `persistNewVault`'s writes after `initializeVaultData` (configured method, passkey credential id / passphrase Argon2 params) were three sequential `browser.storage.local` calls. An interrupted setup (an MV3 service-worker restart is a normal lifecycle event, not a rare crash) between them could persist `configuredUnlockMethod: 'passkey'` with no matching `passkeyCredentialId` — and since `initializeVaultData` already succeeded, a retry would throw `VaultAlreadyInitializedError` with no repair path, permanently stranding the vault. Fixed with `storage.ts`'s `setUnlockMethodMetadata`, which writes the method and its matching credential/params in **one** `browser.storage.local.set()` call — replacing the individual `setConfiguredUnlockMethod`/`setPasskeyCredentialId` setters entirely (keeping two ways to write this data, one atomic and one not, would have reintroduced the exact bug this fix closes). The same review pass also caught `persistNewVault` re-evaluating `unlockMethod === 'passphrase'` a second time with an independently-typed-out `DEFAULT_ARGON2_PARAMS` literal that could drift from the one already used for key derivation — fixed by passing it unconditionally once.
- **Two more `/code-review` findings, fixed in `App.vue`**: the Vault section had no `idle`-state guard, so `vault.store.ts`'s default state (`initialized: false`) flashed "set up your vault" on every popup open — even for an already-initialized vault — until `VAULT_STATUS`'s async reply landed; added a `status === 'idle'` branch matching the Session section's own established pattern. The unlock form's passkey button also only checked `configuredUnlockMethod === 'passkey'`, not whether `passkeyCredentialId` was actually present — defense in depth against that pairing ever landing only partially; the passphrase form now shows whenever the passkey button isn't fully usable, so the user is never left with zero visible way to unlock.
- **`shared/bytes.ts`'s `bytesToBase64Url` was removed** (a `/code-review` finding: no production caller — every base64url value this codebase handles arrives already-encoded by the browser via `credential.id`; only the decode direction, `base64UrlToBytes`, is real production code).
- **Two `/code-review` findings deliberately not fixed**: `handleVaultStatus` calling `getCachedUnlockKey()` (a real `crypto.subtle.importKey`) just to check for `null` was already explicitly validated as acceptable during M3/M4 planning — `importKey` for a raw AES-GCM key is cheap, not Argon2id-expensive, and a parallel cheap-check function would be pure duplication. `stores/vault.store.ts`'s `randomChallenge()` duplicating `background/vault/crypto.ts`'s `randomBytes(n)` (both are `crypto.getRandomValues(new Uint8Array(n))`) was left as-is rather than importing across the popup/background boundary — `stores/` talking to `background/` only via message-passing, never by importing its code directly, is an architectural line kept clean since Phase 1 (`session.store.ts`'s own header comment), not worth crossing for a one-line CSPRNG wrapper.
- **Manual verification in real Chrome**: setup-with-passphrase → unlocked → lock → unlock with the same passphrase → wrong passphrase correctly rejected with the form still available to retry, all confirmed working end to end. Passkey setup and extension-ID dev-reload stability were not explicitly confirmed this session — an honest gap, not a claimed pass.
- **Two follow-ups identified during manual testing, deliberately deferred rather than bolted on**:
  - **Rate-limiting repeated wrong unlock attempts** (exponential backoff, e.g. escalating from minutes to 24h after repeated failures, plus a notification) — a real, valid hardening idea for live-guessing against the popup (distinct from Argon2id's existing offline-brute-force resistance against a stolen encrypted blob). Needs its own design before implementation: where attempt counts live, how/when they reset, `notifications` permission, and how it fits `threat-model.md`'s attacker models. Not scoped into M4.
  - **Changing the configured unlock method after setup** (passphrase ↔ passkey) — not a small addition; it means re-deriving `VaultUnlockKey` and re-encrypting the whole vault blob under the new key, closer to its own milestone than a button. Not scoped into M4.
- **Test coverage**: `tests/unit/background/vault/setup.test.ts` (new) covers both `unlockMethod` branches, the `VaultAlreadyInitializedError` case with the ordering invariant asserted directly (a rejected second call never touches the first vault's metadata/cache), and `persistNewVault` with a caller-provided `VaultData` standing in for M7's future restore case. `tests/unit/background/vault/handler.test.ts` (new) walks the full `uninitialized → initialized+locked → unlocked → locked` state machine the macro plan's acceptance line names explicitly. `tests/unit/stores/vault.store.test.ts` (new) — the only file in the repo using `// @vitest-environment jsdom` — covers both unlock methods, the create-then-get PRF fallback sequencing, and a regression guard asserting the exact same PRF eval-input bytes are used at setup and at every unlock. `tests/unit/shared/bytes.test.ts` extended for `base64UrlToBytes`. No `.vue` component test, matching Phase 1's explicit, deliberate precedent (no `@vue/test-utils`/`@vitejs/plugin-vue` in this repo). Total suite: 167 tests (up from M3's 137), full `pnpm check` and `pnpm build` green.

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

### M5 — Service Identity derivation (ADR-010, concretely)

- `background/identity/derive.ts` — `deriveServiceIdentityKeypair(rootSecret: ArrayBuffer, origin: CanonicalOrigin): Promise<CryptoKeyPair>`: `normalizeOrigin(origin)` (reused directly from `shared/origin.ts`, per ADR-010's own instruction) → UTF-8 bytes as HKDF `info` → `deriveHkdfBits(rootSecret, fixedAppSalt, infoBytes, 256)` → import as an Ed25519 private key (decision 4 — verify Web Crypto's seed-only import empirically here; fall back to `@noble/curves` only if it doesn't behave as needed).
- `background/identity/storage.ts` — reads/writes the `ServiceIdentities` sub-tree via `vault/storage.ts`'s `readVaultData`/`updateVaultData`, not a separate storage path.
- `background/identity/handler.ts` — `handleGetServiceIdentity` (read-only, returns `null` if not yet created), `handleCreateServiceIdentity` (idempotent create).
- `background/router/registry.ts` — add rows for `GET_SERVICE_IDENTITY`, `CREATE_SERVICE_IDENTITY` under the already-reserved `'identity'` capability.
- **Acceptance for M5**: deriving twice from the same `RootSecret` + origin produces byte-identical keypairs (determinism — the core property ADR-010 exists for); two different origins produce visibly different keys; `GET_SERVICE_IDENTITY` returns `null` before creation and the same values after, across a simulated storage read.

#### M5 — Implementation (as built)

- **Decision 4 resolved cleanly in Web Crypto's favor — no `@noble/curves` fallback needed.**
  Verified empirically (real Node `webcrypto`, independently reproduced by a second
  verification pass): `crypto.subtle.importKey('pkcs8', ...)` accepts a bare 32-byte Ed25519
  seed when wrapped in the fixed, standard RFC 8410 §10.3 DER envelope (a 16-byte prefix +
  the 32-byte seed, 48 bytes total) — data encoding, not hand-rolled cryptography. Both
  `'raw'` and `'jwk'`-without-`x` import paths fail. Both halves of the derived keypair are
  deterministic (confirmed via repeated public-key export AND via signature comparison —
  Ed25519 signing is itself deterministic). Full record: **ADR-014** (new, Accepted).
- **`deriveServiceIdentityKeypair` deviates from the macro plan's literal signature in two
  ways**: `rootSecret: Uint8Array`, not `ArrayBuffer` (matching what `deriveHkdfBits`/
  `base64ToBytes` already produce throughout M2-M4); and it returns a new
  `ServiceIdentityKeypair { privateKey, publicKey, identifierB64 }`, not a bare
  `CryptoKeyPair` — `identifierB64` is an unavoidable byproduct of the only reliable
  public-key-export path (there is no "compute public key from private key" Web Crypto
  primitive; the only path is a momentarily-extractable JWK export, immediately discarded in
  favor of a fresh non-extractable key for actual use), so returning it avoids every caller
  needing a redundant second export.
- **`createServiceIdentity` captures its result from inside the `updateVaultData` mutator
  closure, not via a read-back call after the write resolves.** A Plan agent traced a real,
  if narrow, race in the read-back approach: the write-queue serializes *persisted* writes
  correctly, but a follow-up read is not part of that queue, so another write could land in
  the gap and return content the caller's own call never wrote. Not reachable within M5 alone
  (no other writer to `serviceIdentities` exists yet), but closed now rather than rediscovered
  once M6 adds one.
- **`GetServiceIdentityResponse`/`CreateServiceIdentityResponse` reuse `ServiceIdentityRecord`
  directly**, rather than inventing a trimmed response shape the way `VaultStatusResponse`/
  `OriginSummary` were for M3/M4 — confirmed necessary, not just simpler: M7's own acceptance
  criterion requires `GET_SERVICE_IDENTITY` to return "the exact same keypair" before and
  after a backup restore, which needs the full record.
- **The stale-test risk from M3→M4 recurred and was fixed the same way**:
  `tests/unit/background/router/dispatch.test.ts`'s "no registered handler" example moved
  from `GET_SERVICE_IDENTITY` (now registered) to `GET_PERSONAL_DATA` (M6 territory).
- **Doc-fix scope for "Ed25519, not ECDSA" was wider than just `security-model.md`**:
  `identity-model.md`'s own decision blockquote and `browser-architecture.md`'s tech-stack
  table were also corrected. `ADR-003` and `ADR-010` themselves were deliberately left
  unedited (general Web-Crypto-capability description and historical record, respectively) —
  ADR-014 cross-references and narrows ADR-010's phrasing instead.
- **A structural property stated explicitly in ADR-014, not left implicit**: the private key
  is never persisted anywhere, only `identifierB64`. Any future signing use (Phase 3's
  Identity Firewall, most plausibly) must re-derive the private key on demand every time,
  never fetch a cached `CryptoKey` — consistent with ADR-010's "recoverable from root alone"
  property, but a real per-operation cost worth budgeting for up front.
- **A minor plan refinement found during implementation**: the "PKCS8 wrapper regression
  guard" test (48 bytes, prefix bytes correct, seed preserved unchanged) is written as a
  direct unit test of the exported `wrapEd25519SeedAsPkcs8` helper, not as an indirect
  bit-flip-through-HKDF test — there's no practical way to control the HKDF-derived seed's
  exact bits from the outside, so testing the DER envelope construction directly is both
  simpler and a more precise regression guard on the actual risk (an off-by-one/wrong-prefix
  edit), while "different inputs produce different keys" is already covered end to end by
  the origin/rootSecret determinism tests.
- **Two `/code-review` findings, both fixed**: `createServiceIdentity`'s idempotent path
  still called `updateVaultData`, which always re-encrypts and persists the whole vault blob
  after its mutator runs even when the mutator changes nothing — so every repeated "ensure
  identity exists" call for an already-created origin paid a full Ed25519 derivation plus a
  full blob re-encrypt for no reason. Fixed with a fast-path `getServiceIdentity` check that
  returns immediately when the record already exists, skipping derivation and the write-queue
  entirely; the in-mutator existence check on the slow path still covers the residual race
  between that fast-path check and a concurrent creation landing first. Separately,
  `getOrCreateFixedAppSalt` (M2) read `browser.storage.local` on every single call — cheap in
  isolation, but M5 is the first caller to invoke it repeatedly in a tight sequence (once per
  Service Identity derivation). Fixed by caching the resolved salt in a module-level variable
  in `background/vault/salt.ts` — safe specifically because `FixedAppSalt` never changes for
  the vault's lifetime (unlike vault data, which does), naturally cleared on every MV3
  service-worker restart. This required `tests/unit/background/vault/salt.test.ts` to switch
  to `vi.resetModules()` + a fresh dynamic import per test, since `fakeBrowser.reset()` alone
  no longer isolates tests from each other once the module holds its own in-memory cache — a
  real, if narrow, test-isolation gap the cache introduced, caught by a concrete test failure
  (the "only writes once" concurrency test) rather than left latent.
- **Test coverage**: `tests/unit/background/identity/derive.test.ts` (new) covers both-halves
  determinism (identical `identifierB64` and identical signatures across independent
  re-derivations), origin/rootSecret sensitivity, a working sign/verify round trip, the
  returned private key's non-extractability, `identifierB64`'s internal consistency with a
  direct raw export of the returned public key, and the PKCS8 wrapper's exact byte layout.
  `tests/unit/background/identity/storage.test.ts` (new) covers the full
  null-before/record-after lifecycle, idempotent creation, two origins deriving distinct
  identities, and both `getServiceIdentity`/`createServiceIdentity` rejecting with
  `VaultLockedError` when locked. `tests/unit/background/identity/handler.test.ts` (new)
  mirrors the storage-layer lifecycle at the handler layer and confirms origin normalization
  happens at the handler boundary. `tests/unit/background/router/dispatch.test.ts` amended
  per the stale-test fix above; `tests/unit/background/vault/salt.test.ts` amended per the
  caching fix above, plus a new test confirming storage is read only once across repeated
  calls. Total suite: 188 tests (up from M4's 167), full `pnpm check` and `pnpm build` green.
  No manual browser test this milestone — M5 has no UI/`stores/` surface (pure `background/`
  work), matching the macro plan's own scope for this milestone.

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

### M6 — Credentials + Personal Data storage

- `background/vault/credentials/storage.ts`, `handler.ts` — `handleGetCredential`, `handleSaveCredential`, `handleDeleteCredential`, keyed by `CanonicalOrigin`. `CredentialRecord` is either a password entry (real secret, protected only by whole-blob AES-GCM, no field-level encryption — matching Attestto's own validated "not field-level" choice, and consistent with Phase 5's biometric gate being an application-layer consent event, not a separate storage-layer key) or a passkey-reference entry (`rp.id` + `credentialId` only, per ADR-011 — never private key material).
- `background/vault/personalData/storage.ts`, `handler.ts` — `handleGetPersonalData`, `handleSetPersonalData` (patch-style update).
- `background/router/registry.ts` — add rows for `GET_CREDENTIAL`, `SAVE_CREDENTIAL`, `DELETE_CREDENTIAL`, `GET_PERSONAL_DATA`, `SET_PERSONAL_DATA`, all under `'vault'`.
- **Acceptance for M6**: save/get/delete round-trips for a credential at a given origin; setting personal data twice (a patch, not a full overwrite) preserves fields not included in the second patch; both capabilities correctly reject with `VAULT_LOCKED` when no unlock key is cached, via the shared `requireUnlocked()` guard from M3.

#### M6 — Implementation (as built)

- **`readVaultData`/`updateVaultData` imported directly, not the `requireUnlocked` name.** `requireUnlocked` (`background/vault/unlock.ts`) is a bare alias for `readVaultData` that M5's shipped code never actually used — M6 follows M5's real precedent instead of the plan prose's name, for naming consistency across both milestones' code.
- **`saveCredential` is self-sufficient**: it creates the `ServiceIdentityRecord` for an origin that has never been seen before, inside the *same* `updateVaultData` call that sets the credential, rather than requiring `CREATE_SERVICE_IDENTITY` to have run first. A Plan agent's critique caught a real gap in an earlier draft that called `identity/storage.ts`'s `createServiceIdentity()` as a separate step before a second `updateVaultData` call to save the credential — two independent write-queue round trips, with a window between them where another message (e.g. `VAULT_LOCK`) could land and leave an orphaned empty-`credentials` record persisted with no credential ever saved. Fixed by deriving `identifierB64` up front (via `identity/derive.ts`'s `deriveServiceIdentityKeypair` directly — a lower-level dependency than the whole of `identity/storage.ts`) only when no record exists yet, then doing the create-if-missing and the credential-set in one mutator.
- **`GetCredentialResponse` is `CredentialRecord[]`, not a single record** — `GET_CREDENTIAL`'s payload carries no `kind`, so it can only mean "every credential for this origin" (0–2 entries, given the existing at-most-one-per-kind constraint).
- **A `/code-review` finding, fixed**: `setPersonalData`'s shallow-merge patch (`{ ...draft.personalData, ...patch }`) would silently overwrite an existing field with `undefined` if the caller's patch object carried an explicit `undefined`-valued key (e.g. a reactive form object where an untouched field is `undefined` rather than omitted) — verified that Zod's `PersonalDataSchema.parse` preserves such a key as a real own-enumerable property with value `undefined`, so the merge doesn't distinguish "omitted" from "explicitly undefined" on its own. Fixed by stripping `undefined`-valued keys out of the patch before merging, so both cases behave identically ("leave this field untouched").
- **A second `/code-review` finding, fixed**: the "capture a result from inside an `updateVaultData` mutator, then throw if it was somehow never assigned" pattern (established in M5's `createServiceIdentity`) had been copy-pasted a third time across `credentials/storage.ts`'s `saveCredential` and `personalData/storage.ts`'s `setPersonalData`. Factored into a new `updateVaultDataWithResult<T>` helper in `background/vault/storage.ts`, and `identity/storage.ts`'s `createServiceIdentity` (M5) was refactored to use it too, so the pattern now lives in one place instead of three.
- **A `/code-review` finding considered but not changed**: `GET_CREDENTIAL`/`SAVE_CREDENTIAL`/`DELETE_CREDENTIAL` are registered under capability `'vault'` even though they mutate the same `serviceIdentities` sub-tree that `GET_SERVICE_IDENTITY`/`CREATE_SERVICE_IDENTITY` (capability `'identity'`) own — a reviewer flagged this as a potential inconsistency if the `Capability` field is ever used for permissioning. Kept as specified: the macro plan explicitly calls for `'vault'` here (confirmed directly in this doc's own M6 bullet above), a deliberate choice distinguishing "Service Identity record CRUD" from "the data nested inside it," not an oversight.
- `deleteCredential` follows `createServiceIdentity`'s exact idempotency pattern (fast-path read, then an in-mutator recheck against a concurrent delete) — no deviation.
- **Test coverage**: `tests/unit/background/vault/credentials/storage.test.ts` and `handler.test.ts` (new) cover the full get/save/delete lifecycle, same-kind replacement vs. different-kind coexistence, auto-creation of the `ServiceIdentityRecord` (with `identifierB64` determinism across repeated calls for the same new origin), idempotent no-op deletes, origin normalization at the handler boundary, and `VaultLockedError` rejection. `tests/unit/background/vault/personalData/storage.test.ts` and `handler.test.ts` (new) cover the empty-vault default, patch-preserves-omitted-fields (the core acceptance criterion), field overwrite, the `undefined`-stripping regression, and `VaultLockedError` rejection. `tests/unit/background/router/dispatch.test.ts`'s "no registered handler" example moved a third time, from `GET_PERSONAL_DATA` (now registered) to `EXPORT_VAULT_BACKUP` (M7) — its payload is required, not optional like the prior examples, so the test message needed a schema-valid `backupPassphrase` to actually reach the "unregistered" code path instead of failing validation first. Total suite: 212 tests (up from M5's 188), full `pnpm check` and `pnpm build` green. No manual browser test this milestone — M6 has no UI/`stores/` surface, matching the macro plan's own scope.

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

### M7 — Secure export / local backup

- `background/vault/export.ts` — `exportVaultBackup(backupPassphrase)`: derives `BackupExportKey` via Argon2id (M2/decision 3) with a fresh random Argon2 salt, encrypts a bundle containing **both** the full `VaultData` **and** the current `FixedAppSalt` together (per decision 2 — omitting the salt is the specific, easy-to-miss bug that would silently re-derive wrong Service Identities on restore) — bundle format: `{ formatVersion: 1, kdf: 'argon2id', kdfParams, argon2Salt, iv, ciphertext }`, JSON-serialized.
  - `restoreVaultBackup(fileContents, backupPassphrase, newUnlockInput)`: decrypts the bundle, then runs the *same* setup path as M4's `createRootIdentity` but seeded with the restored `VaultData`/`FixedAppSalt` instead of freshly generated ones, and a **newly chosen** unlock method on this device (the old device's `VaultUnlockKey` is never portable — that's the point of the three-key hierarchy, decision 5).
- `background/vault/handler.ts` — `handleExportVaultBackup`, `handleRestoreVaultBackup`.
- `background/router/registry.ts` — add rows for `EXPORT_VAULT_BACKUP`, `RESTORE_VAULT_BACKUP` under `'vault'`.
- `stores/vault.store.ts` / `entrypoints/popup/App.vue` — an "Export backup" action (triggers a file download of the bundle) and a "Restore from backup" flow (file input + backup passphrase + new-unlock-method setup, reusing M4's setup UI).
- **Acceptance for M7**: export → corrupt one byte of `ciphertext` → import fails cleanly (AES-GCM tag rejection, not a silent garbage decrypt); export → restore into a simulated fresh vault → `GET_SERVICE_IDENTITY` for a previously-derived origin returns the **exact same** keypair as before export — the concrete test proving `FixedAppSalt` carried correctly through the bundle, not just that the bundle round-trips at all.

#### M7 — Implementation (as built)

- **Bundle field names corrected against the actual schema**: the bullet above's `argon2Salt`/`iv`/`ciphertext` sketch is stale prose — the already-implemented `VaultBackupBundleSchema` (`shared/messages.ts`, built ahead of this milestone) uses `argon2SaltB64`/`ivB64`/`ciphertextB64`. Implemented against the schema, not the prose.
- **A real concurrency bug, found by a Plan agent before implementation and fixed before it could ship**: `persistNewVault` (M4) calls `getOrCreateFixedAppSalt()` internally rather than accepting a salt parameter. A naive `restoreVaultBackup` doing "check `vaultBlobExists()` → write the restored salt → call `persistNewVault()`" as three separate awaited steps has no serialization against a concurrent `createRootIdentity` (or another concurrent restore) — two racing calls could both pass the existence check while nothing exists yet, and end up pairing one call's `VaultData` with the *other* call's `FixedAppSalt`, silently, since AES-GCM never fails regardless of which salt derived the key. The only symptom would have been every future `GET_SERVICE_IDENTITY` returning a wrong keypair, forever, with no error anywhere. Fixed by restructuring `background/vault/setup.ts`: the old `persistNewVault` body became a private `writeNewVault`, wrapped by a private serializing queue (`enqueueFirstVaultWrite`) that both the public `persistNewVault` (unchanged signature, so no other caller needed to change) and a new `restoreNewVault` (the vault-existence check, the `FixedAppSalt` install, and `writeNewVault` all inside *one* queued task) funnel through. `background/vault/export.ts`'s `restoreVaultBackup` calls `restoreNewVault`, not `persistNewVault` directly, and no longer touches `vaultBlobExists`/salt-writing itself.
- **A second concurrency bug in the same family, found by `/code-review` on the already-implemented code**: `background/vault/unlock.ts`'s `unlockVault()` also calls `getOrCreateFixedAppSalt()`, entirely outside `setup.ts`'s queue — a stray `VAULT_UNLOCK` message racing a `RESTORE_VAULT_BACKUP` on a device with no vault yet could still have `unlockVault`'s own generate-and-persist branch overwrite a just-installed backup salt. Fixed by moving the serializing queue into `background/vault/salt.ts` itself, not just `setup.ts` — `getOrCreateFixedAppSalt`/`setFixedAppSalt` now share one queue local to that module, so *every* caller is serialized against every other one, regardless of which module calls in. The module's earlier one-shot in-flight-promise memo (added in M5) was removed in favor of this, with the already-cached fast path preserved so M5's per-Service-Identity-derivation performance fix isn't undone.
- **A third `/code-review` finding, fixed**: the serializing-queue pattern (`let queue = Promise.resolve(); function enqueue(task) {...}`) had been independently reimplemented three times — `background/vault/storage.ts`'s pre-existing `writeQueue`, the new `setup.ts` queue above, and the new `salt.ts` queue above (`background/session/state.ts` has a fourth, pre-existing instance from Phase 1, left untouched as out-of-scope for this diff). Factored into a new `background/vault/serialQueue.ts`'s `createSerialQueue()`, and `storage.ts`/`setup.ts`/`salt.ts` all now share it.
- **A `/code-review` finding on the popup store, accepted as a documented limitation rather than fixed**: `restoreWithPasskey` validates the uploaded file's JSON *shape* (via `VaultBackupBundleSchema.safeParse`) before running any WebAuthn ceremony — closing the gap a Plan agent found (a structurally-malformed file would otherwise register a real, un-revocable resident credential before the background's own validation ever ran). But a schema-*valid* file with a wrong `backupPassphrase`, or one whose ciphertext got corrupted while staying schema-valid, still can't be caught client-side, since decryption only happens in the background (`stores/vault.store.ts` never touches `crypto.subtle`, by design — see its own header comment). Properly closing this would need a new "verify this bundle decrypts" message the popup could check before touching WebAuthn at all — a real message-contract addition, not a same-milestone bug fix, so it's documented in the store's own code comment and left as a follow-up rather than done ad hoc.
- **A fourth `/code-review` finding, fixed**: `restoreWithPasskey`/`restoreWithPassphrase`'s message-construction-and-response-typing was near-identical boilerplate; extracted into a shared `sendRestoreVaultBackup` helper. The surrounding `status`/try-catch skeleton was deliberately *not* further merged — every action in this store already repeats that skeleton inline (matching `session.store.ts`'s own convention), so a deeper merge would have been less consistent with the file's existing style, not more.
- **`createPasskeyUnlockInput()`** extracted from `setupWithPasskey`'s own WebAuthn-ceremony body so `restoreWithPasskey` doesn't duplicate it; `setupWithPasskey`'s post-success state update now reads `credentialId` off the returned `UnlockInput` rather than needing the raw `PublicKeyCredential` separately.
- **The dispatch stale-test pattern reached its natural end and was fixed permanently, not patched a fourth time**: after this milestone, all 16 message types in `ExtensionMessageSchema` have real registered handlers, so there's no schema-valid "still unregistered" type left for `dispatch.test.ts`'s example to point at. Restructured to simulate the missing-handler condition directly against the `registry` object (`delete`-then-restore one real entry, `GET_SESSION_STATE`, for one test) instead of depending on the registry's fill state — it will never need editing again as future milestones register more types.
- **Test coverage**: `tests/unit/background/vault/export.test.ts` (new) uses `vi.resetModules()` + fresh dynamic imports to simulate two separate devices within one Vitest worker (module-level state in `salt.ts`/`setup.ts`/`storage.ts` would otherwise leak across the simulated boundary), covering the core export→restore round-trip (identical `identifierB64` after restore), wrong-backup-passphrase and corrupted-ciphertext rejection, restore-onto-an-already-initialized-vault rejecting without ever writing the salt storage key, and a concurrency regression test (`Promise.allSettled` on a racing `createRootIdentity`/`restoreVaultBackup` pair) that's the concrete regression guard for the two concurrency fixes above. `background/vault/handler.ts`'s existing test file and `stores/vault.store.ts`'s existing test file were both extended to match. Total suite: 226 tests (up from M6's 212), full `pnpm check` and `pnpm build` green.
- **Manual browser testing**: _pending — this is the first milestone since M4 to touch the popup UI; results to be recorded here once complete._

Retrofitted by the vault storage tiering refactor — see [ADR-015](../adr/ADR-015-three-tier-vault-storage.md) and `phase-2-vault-tiering-refactor.md`.

### M8 — Test consolidation + Playwright vault e2e

- Consolidate the crypto-vs-DOM environment split from M2 into an explicit rule documented in `vitest.config.ts`'s own comments: crypto-touching files stay on the default `node` environment; only `stores/vault.store.ts`'s WebAuthn-mocking tests opt into `// @vitest-environment jsdom`, and never call real `crypto.subtle`.
- `tests/e2e/vaultLifecycle.test.ts` (new, extends Phase 1's Playwright fixture pattern) — launches the real build, drives the popup UI through setup → lock → (force a real service-worker restart, same manual-becomes-automated technique as Phase 1's M6/M7) → unlock → confirms a Service Identity survives intact.
- **Acceptance for M8**: the full Vitest suite passes with the environment split holding (no file needs both jsdom and real `crypto.subtle`); the Playwright vault-lifecycle test passes 5/5 consecutive runs, matching Phase 1's own flakiness bar.

#### M8 — Implementation (as built)

- **Corrected a claim in this doc's own M8 bullet above**: "same manual-becomes-automated technique as Phase 1's M6/M7" doesn't refer to anything that actually exists. An Explore agent found Phase 1's own e2e test explicitly states it *deliberately did not attempt* to automate the service-worker restart ("Playwright doesn't reliably control that timing"), and Phase 1's M7 restart check was, and remains, a human manually clicking Stop on `chrome://serviceworker-internals/`. Rather than accept that limitation for M8, a genuinely new technique was found and verified: forcing an immediate, on-demand termination via Chrome DevTools Protocol (`Target.closeTarget` on the extension's `service_worker`-type CDP target, reached via a **browser-level** CDP session — `context.newCDPSession()` only accepts a Page/Frame, not a worker) — this sidesteps the original timing problem entirely, since nothing waits out an idle timer.
- **A second empirical correction, found only after the first implementation attempt failed**: the initial design proved "a restart genuinely occurred" by polling for the CDP target's `targetId` to change after the kill. This is **wrong** — confirmed by instrumenting the actual failure: Chrome reuses the identical `targetId` for the respawned worker of the same extension, every time, so that check reliably timed out (30 consecutive poll attempts, same ID throughout) even though the restart had, by other measures, genuinely happened. The working, verified-in-practice signal instead: a `globalThis` marker set via `Worker.evaluate()` on the pre-kill worker, confirmed `undefined` on the post-wake worker (`context.serviceWorkers()` correctly tracks the live respawned worker, not a stale reference to the killed one) — module-level JS state cannot survive a genuine context teardown, regardless of what CDP's own target bookkeeping reports.
- **Closing the target does not respawn it by itself** — MV3 service workers are purely event-driven and stay dead until something asks them to do something. The fixture's `restartServiceWorker()` explicitly triggers a wake afterward: a throwaway page navigated to the extension's own popup, which then explicitly sends and **awaits** a real `VAULT_STATUS` message response (not just the navigation itself, and not relying on the popup's own `onMounted` hook firing asynchronously) — an earlier version that only navigated and closed the page immediately was itself flaky, since closing could race ahead of the in-page async message dispatch.
- **The test itself adds a separate app-layer warm-up** (`expect.poll()` on a raw `VAULT_STATUS` message, before ever touching the UI) so a wake failure is diagnosed at that specific step rather than surfacing as a generic UI-assertion timeout several steps later — a forced CDP kill is a more abrupt termination than the natural idle-timeout MV3's wake-on-event logic was primarily built and tested against, so this isn't purely defensive.
- **`playwright.config.ts` gained a repo-wide `expect: { timeout: 15_000 }`** (up from Playwright's 5s default) — `deriveVaultUnlockKey`'s Argon2id call runs through `@noble/hashes`'s pure-JS implementation (no WASM/native), a cost that recurs in every vault e2e test this project will ever write, not just this one.
- **`tests/e2e/fixtures/extension.ts` (new)** extracts `formDetection.test.ts`'s own inline `context`/`extensionId` fixture (Phase 1) into a shared file once M8's `vaultLifecycle.test.ts` needed the identical setup plus a third fixture, `restartServiceWorker` — this is M8's actual "test consolidation," not a separate task from the e2e work.
- **Setup/lock/unlock in the new e2e test go through the real popup UI** (fill the passphrase input, click the real button), not raw messages — exercising `stores/vault.store.ts`'s actual code paths. Only `CREATE_SERVICE_IDENTITY`/`GET_SERVICE_IDENTITY` go through `popup.evaluate(() => chrome.runtime.sendMessage(...))`, since there is genuinely no UI for them yet (confirmed via grep, not assumed) — that's Phase 3's job.
- **Verification**: `pnpm check` unaffected (249 tests, no production code touched). `pnpm test:e2e` run 5 times consecutively post-fix, both `formDetection.test.ts` (unchanged behavior, now via the shared fixture) and `vaultLifecycle.test.ts` passing every time, each full run completing in ~2s.
- **`/code-review` pass**: eight independent finder agents converged repeatedly on the same handful of real issues in `restartServiceWorker`, so all were fixed before commit: (1) two separate `browser.newBrowserCDPSession()` calls per restart, neither detached — merged into one session, detached in a `finally`; (2) the pre-kill/post-wake "is the extension's service worker respawned" lookup was duplicated between the `extensionId` and `restartServiceWorker` fixtures — extracted into one shared `getServiceWorker()` helper; (3) the hand-rolled 30×500ms polling loop for the post-restart marker check duplicated what `expect.poll()` already does (and already does twice more in the same test file) — replaced with `expect.poll(..., {timeout: 15_000})`. Left alone as either by-design or too speculative to act on: the repo-wide (not per-file) `expect.timeout` bump (Design decision 4 above explains why it's deliberately shared); a possible stale-worker race in `getServiceWorker()` if Playwright's service-worker list briefly lists both the closing and respawned worker (theoretical, not reproduced, and the existing `.catch()`-guarded retry already tolerates most manifestations of it); `Target.closeTarget`'s `{success}` result going unchecked (would add complexity for a case — an already-dead target — the marker check downstream already positively verifies).

### M9 — Manual acceptance pass

Mirrors Phase 1's M7 exactly, but exercising Phase 2's crypto instead of session storage — run against the real production build, in real Chrome, with a real platform authenticator:

- [x] Setup with a real PRF-capable passkey succeeds; the popup shows "unlocked."
- [x] Locking, then terminating the service worker (`chrome://serviceworker-internals/`, same technique Phase 1's M7 validated), then reopening the popup shows "locked" — not "uninitialized" and not a crash — proving the persistent encrypted vault index (`vaultIndexExists()`) and the unlock-key cache (session-only, correctly cleared by the restart) are tracked separately as designed.
- [x] Unlocking again with the same passkey decrypts the same `PersonalData`/Service Identities set up earlier.
- [x] Setting up a second profile with a passphrase-only fallback (no PRF) succeeds and unlocks correctly — proving the fallback path isn't just unit-tested fiction.
- [x] Export a backup, then restore it into a fresh profile with a *new* unlock method — the restored profile's `GET_SERVICE_IDENTITY` for a known origin returns the identical key as the original profile.
- [x] Every "Data" and "Recovery" question in [`threat-model.md`](../threat-model.md)'s security-review checklist has a concrete, stated answer for this phase's design specifically (this is also the Phase-3 gate below — doing it here first is the actual work; the gate just confirms it happened).

#### M9 — Implementation (as built)

Run manually against the real production build, in real Chrome, with a real Windows Hello platform authenticator (not simulated — WebAuthn PRF can't be scripted in Playwright, which is exactly why this milestone stays manual):

- **Passkey setup + real restart survival**: setup with a real passkey succeeded ("Vault unlocked."). Locking, then stopping the service worker via `chrome://serviceworker-internals/`, then reopening the popup (a fresh mount, not the stale already-open one — MV3 popups only refetch state on a new open) correctly showed "Vault is locked." — not "uninitialized," no crash. This is actually the stronger form of the check: no explicit Lock click preceded the restart, so this proves the in-memory unlock-key cache doesn't survive a genuine service-worker restart on its own, not merely that an explicit Lock works.
- **Re-unlock**: unlocking again with the same passkey succeeded ("Vault unlocked.").
- **Second profile, passphrase-only**: a separate Chrome profile, loaded with the same unpacked build, set up via the passphrase field (not the passkey button) and unlocked correctly — creating its own Service Identity for `https://example.com` produced a completely independent `identifierB64`, as expected for an unrelated root identity.
- **Backup/restore round-trip**: from the original passkey profile, created a Service Identity for `https://example.com` (`identifierB64 = 1DY3BB4gJiP31ZM8yqcwFYEoq7zhh8XhOSEIccGPPb8=`, via `CREATE_SERVICE_IDENTITY` — no UI yet, Phase 3's job), exported a backup under a chosen backup passphrase, then restored it into a third profile with a *different* unlock method than the original. `GET_SERVICE_IDENTITY` for the same origin in the restored profile returned the **identical** `identifierB64`, while `payloadStorageKey` came back as a freshly-generated UUID — exactly ADR-015's design: the identity is preserved, storage keys are always regenerated fresh on restore, never meaningful across devices.
- **Threat-model checklist**: see the updated "Gate to start Phase 3" table below, rewritten to describe the current three-tier vault (the previous table described the pre-ADR-015 single-blob design and was stale).

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
- ~~**TypeScript's bundled DOM lib and the `prf` extension type**~~ — **Resolved (M4).** TypeScript 5.9.3's bundled `lib.dom.d.ts` already natively types the PRF extension (`AuthenticationExtensionsClientInputs.prf`, `...ClientOutputs.prf`, `AuthenticationExtensionsPRFInputs`/`Outputs`/`Values`, confirmed by reading the installed `.d.ts` directly) — no local type augmentation needed in `stores/vault.store.ts`.
- ~~**Whether `@noble/hashes`'s Argon2id build works unmodified under WXT's bundler/MV3 service-worker context**~~ — **Resolved (M2).** Confirmed pure JS/TS, no WASM (read the real GitHub source); `pnpm build`'s output `manifest.json` has no `content_security_policy` field at all.
- **Exact popup UI real estate for the WebAuthn ceremony** (toolbar popup vs. a dedicated setup page opened in a new tab) — Attestto uses a separate `approval.html` window for its consent flows but its own vault unlock happens directly in the toolbar popup; confirm the toolbar popup's default WXT dimensions are workable for a setup form with method choice, or add a dedicated `entrypoints/setup.html` page if not. Low-risk either way, doesn't block earlier milestones.

---

## Gate to start Phase 3

Phase 1 shipped without a "Gate to start Phase 2" and that was fine — an extension that detects forms carries no security consequence if subtly wrong. Phase 2's output is different: it's the encryption/key-management layer every later phase's security claims rest on directly. Phase 3 starts handing real credentials and personal data to actual third-party sites; if the vault's derivation or encryption is subtly wrong, every site the user ever authorizes inherits that flaw silently. This is the same asymmetry that justified Phase 0's own gate before any code existed ([`roadmap.md`](../roadmap.md)'s "Gate to start Phase 1") — worth one more explicit checkpoint here.

Only move on to Phase 3 once every "Data" and "Recovery" question in [`threat-model.md`](../threat-model.md)'s security review checklist has a concrete, written answer for the vault specifically — not a generic answer, the actual one:

```text
DATA
 - Where does the data live?             -> browser.storage.local, split into three independently-
                                             encrypted tiers: the vault index (if_vault_index_v1),
                                             the personal-data blob (if_vault_personal_data_v1), and
                                             one per-site payload blob per origin
                                             (if_vault_site_<payloadStorageKey>_v1, payloadStorageKey
                                             a random UUID never derived from the origin)
 - Is it encrypted?                      -> AES-256-GCM per tier, each with its own random 12-byte
                                             IV and its own independently-derived key -- decrypting
                                             one tier (e.g. one site's credentials) never requires or
                                             exposes the other two
 - Who holds the keys?                   -> the user, exclusively. VaultUnlockKey comes from a
                                             WebAuthn PRF output (primary) or Argon2id over a
                                             passphrase (fallback); RootSecret and every per-tier key
                                             are derived from it via HKDF-SHA256 with domain-separated
                                             info strings (ADR-010, ADR-015). No key material is ever
                                             persisted in plaintext or leaves the device -- there is
                                             no server to hand it to.
 - What leaves the device?               -> nothing, by default. The only device-crossing artifact
                                             is a user-initiated backup file (M7), itself AES-GCM-
                                             encrypted under a user-chosen backup passphrase -- it
                                             leaves the device only when the user explicitly downloads
                                             it, and stays under the user's own custody.

RECOVERY
 - What happens if the device is lost?   -> without a backup, the vault is unrecoverable -- stated
                                             plainly, no other claim made. With a backup, restore
                                             reconstructs an equivalent vault on a new device/profile
                                             (verified live in M9: identical Service Identity
                                             identifierB64 recovered under a newly-chosen unlock
                                             method).
 - Does a backup exist?                  -> yes, user-triggered only, never automatic and never
                                             uploaded anywhere by the extension itself -- it bundles
                                             the index tier, personal-data tier, and every site's
                                             payload (keyed by origin, not the original device's
                                             meaningless-elsewhere payloadStorageKey) into one
                                             Argon2id/AES-GCM-encrypted downloadable file.
 - Who can recover the identity/vault?   -> whoever holds both the backup file and the backup
                                             passphrase chosen at export time -- nobody else; there
                                             is no server-side copy or escrow of any kind.
 - Does the backup contain private keys? -> yes, once decrypted -- say this plainly. RootSecret and
                                             everything derived from it (every Service Identity's
                                             Ed25519 seed, every credential, every alias) is
                                             reconstituted from the backup. Its confidentiality rests
                                             entirely on the strength of the backup passphrase chosen;
                                             Argon2id makes brute-forcing expensive, not unnecessary.
```

Verified live in M9: a real service-worker restart never exposes plaintext and never silently loses initialization state (`vaultIndexExists()`) — the Phase 2 equivalent of Phase 1's M7 "terminate the service worker and reopen the popup" centerpiece test.

---

## What "done" means for Phase 2

All of M1–M9 pass, and the result is a vault that survives a real device restart and a real service-worker restart with zero plaintext ever touching persistent storage; a Root Identity that deterministically re-derives the exact same Service Identity for the same origin every time, on this device or a restored one; a documented, justified answer (via ADR-012/013/014) to every open cryptographic design question this phase inherited; and every later phase's data trees (Aliases, Policies, Privacy Ledger) already shaped and encrypted, with none of their behavior built early.
