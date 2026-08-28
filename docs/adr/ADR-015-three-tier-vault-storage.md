# ADR-015: Three-tier vault storage — index, personal data, per-site payload

## Status
Accepted

## Context
M1–M7 built the vault as a single encrypted blob (`if_vault_blob_v1`): one `VaultData` JSON tree, one AES-256-GCM ciphertext, decrypted whole on every `readVaultData()`/`updateVaultData()` call (`background/vault/storage.ts`). This was a deliberate, documented choice at M1 — "protected only by whole-blob AES-GCM, matching Attestto's own validated choice" (`shared/vault-schema.ts`'s `PasswordCredentialSchema` comment) — reasonable while the vault was standalone and nothing outside the popup ever queried it.

That stops being sufficient once two things become real, both surfaced while scoping Phase 3 (Identity Firewall) before writing its own plan:

1. **Checking one site materializes every site.** `getCredentials(origin)`/`getServiceIdentity(origin)` (M5/M6) call `readVaultData()`, which decrypts the *entire* tree — every other site's passwords, every alias, all of `PersonalData` (including `nationalId`, classified `highlySensitive` in `data-model.md`) — just to read one origin's entry out of it. The plaintext of everything the user has ever saved briefly exists in the background service worker's memory on every single credential check, not just the one the caller asked for. Not persisted, garbage-collected after the call — but a real exposure window against Attacker C (local malware/compromised device, `threat-model.md`) that a scoped read would not have.
2. **There is no way to answer "which sites do I have an account for?" without full decryption**, and no cheap way to add one. A naive fix — an unencrypted, hashed index of known origins, checkable before unlock — was evaluated and rejected: origin/domain strings are low-entropy (public top-1M domain lists exist), so a keyed hash whose key is itself available pre-authorization is trivially reversible by dictionary attack against a realistic adversary. Concretely, this would regress the project's own threat-model promise for Attacker D (device theft / offline access, `threat-model.md`), which explicitly commits to protecting the vault's contents against exactly that scenario. No pre-unlock index is being built as a result (see Decision, part 3).

## Decision

Replace the single blob with three independently-encrypted tiers, all still under the same `VaultUnlockKey` (no new unlock ceremony, no second password):

```text
Tier 1 — INDEX (if_vault_index_v1)
  RootIdentity (rootSecretB64), per-origin METADATA ONLY
  (identifierB64, createdAt, credential kinds present, alias count,
  history, a random payloadStorageKey per origin), policies, privacy ledger.
  No credential/alias VALUES. Decrypted on every unlock — this is the
  "site recognition" layer requested in the design discussion.

Tier 2 — PERSONAL DATA (if_vault_personal_data_v1)
  name/email/phone/nationalId/address/birthDate. Its own ciphertext,
  independent of Tier 1 and Tier 3 — checking "do I have an account for
  site X" never touches this.

Tier 3 — SITE PAYLOAD (if_vault_site_<random-id>_v1, one per origin)
  The real credential/alias VALUES for one origin. Decrypted only when
  that specific origin's data is actually requested, using a key derived
  on demand: HKDF(RootSecret, FixedAppSalt, origin + ":site-payload")
  — the same derivation pattern ADR-010 already uses for the per-origin
  Ed25519 identity, applied to a symmetric AES-256-GCM key instead.
```

Three supporting rules, each closing a specific gap found while designing this:

1. **Per-site storage key names are random, never derived from the origin.** If a site's blob were named deterministically from its origin (even hashed), an attacker with mere read access to `browser.storage.local` — no decryption needed — could enumerate candidate origins against the naming scheme and recover the site list from key *names* alone, defeating Tier 1's entire purpose. Each `ServiceIdentityMeta` entry in the index instead carries a random `payloadStorageKey` (a UUID), and that origin→key mapping exists nowhere except inside the encrypted index.
2. **Field-level encryption is explicitly rejected.** Splitting `PersonalData` or a site's own credential fields into individually-encrypted values was considered and dropped: AES-GCM's per-ciphertext overhead (12-byte IV + 16-byte tag) is significant relative to a field like `email`, the write-path complexity roughly multiplies, and the marginal security gain is small — whoever already decrypted a small, already-isolated blob (Tier 2, or one Tier 3 entry) has already obtained what matters. Minimization at the *field* level is instead an API-layer contract: every getter (`getPersonalData`, `getCredentials`, and whatever Phase 3/4 add) takes an explicit list of requested fields and returns only those, even though it decrypted a small blob containing more. This is cheap, and it's already the shape the Policy Engine/Privacy Ledger (`privacy-model.md`) assume (`approved_fields`/`denied_fields`, per field, not per record).
3. **No pre-unlock index.** Per Context point 2, this ADR does not add any signal readable before `VaultUnlockKey` exists. "Site recognition" means: unlock once (already session-cached since M3/M4 — `browser.storage.session`, cleared on lock or browser restart), then Tier 1 answers "which sites" cheaply and silently for the rest of that session, without re-prompting biometrics per site and without decrypting Tier 2 or any Tier 3 entry.

## Consequences

- **Real reduction in exposure blast radius.** A credential check for one origin now decrypts: the index (metadata only, no secrets) plus that one origin's payload. Every unrelated site's actual secrets are never decrypted, never touched, for that call.
- **Does not protect against a fully-compromised vault.** `RootSecret` still lives in Tier 1, and Tier 1 is still decrypted on every unlock — an attacker who has genuinely obtained `VaultUnlockKey` can still derive any site's Tier 3 key on demand. This tiering reduces accidental/incidental exposure and attack surface; it is not a defense against a successful full compromise, and must not be described as one.
- **Sets up Phase 5 cleanly.** Because Tier 3 access is already a separate derivation step from Tier 1's unlock, gating specific Tier 3 reads behind a fresh biometric re-authorization (the `Level 0–3` sensitivity model already sketched in `roadmap.md`'s Phase 5) is an additive check at the Tier 3 boundary, not a redesign.
- **One-time refactor cost across already-shipped, tested milestones.** `shared/vault-schema.ts` (M1), `background/vault/storage.ts` (M3), `setup.ts`/`unlock.ts` (M4), `background/identity/*` (M5), `background/vault/credentials/*` and `personalData/*` (M6), and `background/vault/export.ts` (M7) all change. Execution sequence and per-step scope are in `docs/plans/phase-2-vault-tiering-refactor.md`.
- **Write-queue serialization changes shape.** M3's single global write queue (generalized further in M7 via `background/vault/serialQueue.ts`'s `createSerialQueue()`) becomes one queue per storage key (index, personal data, and each site payload independently) rather than one queue for the whole vault — otherwise an unrelated site's write would block on this site's write for no real reason. `createSerialQueue()` itself does not change; it's instantiated per key instead of once globally.
