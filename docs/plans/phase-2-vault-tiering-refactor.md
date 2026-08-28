# Phase 2 — Vault storage tiering refactor: execution plan

Companion to [ADR-015](../adr/ADR-015-three-tier-vault-storage.md), which has the full rationale. This document is the concrete, sequenced execution plan, following the same before-code discipline `phase-2-local-identity-vault.md` used — read that ADR first if the "why" here is unclear.

## Why now, not later

M7 (secure export/backup, commit `884178b`) just landed — 226 tests green, `pnpm check`/`pnpm build` clean, nothing else in flight. This is the cheapest point this refactor will ever be:

- M7 is the one milestone that legitimately touches "the whole vault at once" (a backup must contain everything) — doing this refactor right after it, instead of mid-M7, meant not rewriting `export.ts` twice.
- Phase 3 (Identity Firewall) hasn't started consuming `getCredentials`/`getPersonalData` yet. Every week that passes before this lands is more Phase 3 code written against the old whole-blob shape that would then need migrating too.
- M1–M7 are shipped, tested, and stable — a clean baseline to refactor from, not a moving target.

## Scope

Touches, in this order: `shared/vault-schema.ts` (M1) → key derivation (M2) → `background/vault/storage.ts` (M3) → `setup.ts`/`unlock.ts` (M4) → `background/identity/*` (M5) → `background/vault/credentials/*` + `personalData/*` (M6) → `background/vault/export.ts` (M7). Nine steps, each independently committable, each ending in a green `pnpm check`.

Does **not** touch: `background/vault/crypto.ts`'s primitives (HKDF/AES-GCM/CSPRNG stay as-is), `background/vault/salt.ts` (`FixedAppSalt` lifecycle is orthogonal to this), `background/vault/serialQueue.ts` (reused as-is, just instantiated per storage key instead of once globally), or anything in `background/formDetection/`, `background/session/`, or Phase 1 content-script code.

## Target shapes (reference — full rationale in ADR-015)

```ts
// shared/vault-schema.ts — new/changed shapes

// Tier 1 — if_vault_index_v1
VaultIndexSchema = {
  schemaVersion: 1,
  rootIdentity: RootIdentitySchema,          // unchanged
  serviceIdentities: Record<origin, ServiceIdentityMetaSchema>,  // was ServiceIdentityRecordSchema
  aliasProviderConfig: AliasProviderConfigSchema,  // unchanged
  policies: PolicyRuleSchema[],              // unchanged
  privacyLedger: PrivacyLedgerEntrySchema[], // unchanged
}

ServiceIdentityMetaSchema = {
  origin: string,
  identifierB64: string,
  createdAt: number,
  credentialKinds: CredentialRecord['kind'][],  // e.g. ['password'] -- kinds present, not values
  aliasCount: number,
  history: ServiceIdentityHistoryEntrySchema[],
  payloadStorageKey: string,   // random UUID, generated once at first credential/alias save -- NEVER derived from origin
}

// Tier 2 — if_vault_personal_data_v1
// PersonalDataSchema itself is UNCHANGED (shared/vault-schema.ts already has it) --
// it just moves to its own top-level storage key instead of nesting in VaultData.

// Tier 3 — if_vault_site_<payloadStorageKey>_v1
SitePayloadSchema = {
  origin: string,          // redundant with the index entry, kept for a standalone-decrypt sanity check
  credentials: CredentialRecord[],   // real values -- unchanged shape, new home
  aliases: AliasRecord[],            // real values -- unchanged shape, new home
}
```

`VaultDataSchema` (the old single-tree type) is deleted once all three consumers below are migrated — do not keep it around "just in case."

## Storage-key naming

| Tier | Storage area | Key |
|---|---|---|
| 1 — Index | `browser.storage.local` | `if_vault_index_v1` (replaces `if_vault_blob_v1`) |
| 2 — Personal data | `browser.storage.local` | `if_vault_personal_data_v1` |
| 3 — Site payload | `browser.storage.local` | `if_vault_site_<uuid>_v1` — `<uuid>` is `ServiceIdentityMeta.payloadStorageKey`, never the origin |

`FixedAppSalt` (`if_vault_salt_v1`), the passphrase Argon2 params, unlock-method metadata, and the session-cached `VaultUnlockKey` (`browser.storage.session`) are all unaffected — they're already outside `VaultData` and stay exactly where M2–M4 put them.

## Step-by-step

Each step below has a matching copy-paste prompt in the **Execution prompts** section — same numbering. Run `pnpm check` and `pnpm build` green before moving to the next step; commit after each (suggested commit subject given in each prompt).

1. **Schema split** — `shared/vault-schema.ts` gains `VaultIndexSchema`, `ServiceIdentityMetaSchema`, `SitePayloadSchema`; `VaultDataSchema`/`ServiceIdentityRecordSchema` deprecated (kept only until Step 6 finishes migrating their last consumer, then deleted in Step 6). `shared/messages.ts`'s payload/response types that currently reference `ServiceIdentityRecord`/`VaultData` shapes get updated to the new ones.
2. **Site payload key derivation** — a new `deriveSitePayloadKey(rootSecret, origin)` (new file `background/vault/siteKey.ts`, mirroring `background/identity/derive.ts`'s structure but producing an AES-256-GCM `CryptoKey` via `generateAesGcmKeyFromBits` instead of an Ed25519 pair), with an `info`/personalization string distinct from `identity/derive.ts`'s (domain separation, same convention as `keys.ts`'s existing `PASSKEY_UNLOCK_INFO`/`PASSPHRASE_UNLOCK_PERSONALIZATION`).
3. **Storage layer rewrite** — the core of this refactor. `background/vault/storage.ts`'s single blob + single `writeQueue` becomes three read/write surfaces (`readVaultIndex`/`updateVaultIndex`/`initializeVaultIndex`, `readPersonalDataBlob`/`updatePersonalDataBlob`/`initializePersonalDataBlob`, `readSitePayload(payloadStorageKey)`/`updateSitePayload(payloadStorageKey, mutator)`/`initializeSitePayload`), each with its own `createSerialQueue()` instance — one per storage key for site payloads (a `Map<string, ReturnType<typeof createSerialQueue>>`, created on demand), not one shared queue. `VaultLockedError`/`VaultNotInitializedError`/etc. stay, now thrown uniformly across all three surfaces.
4. **Setup/unlock adaptation** — `setup.ts`'s `persistNewVault`/`restoreNewVault` initialize the index + an empty personal-data blob (no site payloads yet — those are created on first credential/alias save, Step 6). `unlock.ts`'s `unlockVault` verifies the derived key by decrypting the *index* (smaller, faster — a nice side effect), not the old whole blob.
5. **Identity module adaptation** — `background/identity/{derive,storage,handler}.ts`. `getServiceIdentity`/`createServiceIdentity` read/write only the index tier. `createServiceIdentity` additionally mints a random `payloadStorageKey` (via `crypto.randomUUID()` or `randomBytes` + hex/base64url) and calls `initializeSitePayload` with an empty `{ origin, credentials: [], aliases: [] }`.
6. **Credentials + personal data adaptation** — `background/vault/credentials/{storage,handler}.ts` resolve `payloadStorageKey` from the index (creating the identity + empty payload first if missing, same self-sufficient pattern M6 already uses), then read/write only that site's Tier 3 blob. `background/vault/personalData/{storage,handler}.ts` switch to `readPersonalDataBlob`/`updatePersonalDataBlob`. **Delete `VaultDataSchema`/`ServiceIdentityRecordSchema`/`updateVaultData`/`updateVaultDataWithResult`/`readVaultData` here** once nothing references them.
7. **Export/restore adaptation** — `background/vault/export.ts`'s `exportVaultBackup` gathers the index, personal-data blob, and every site's payload (iterate `Object.values(index.serviceIdentities)`, read each `payloadStorageKey`) into one flat bundle payload instead of one `readVaultData()` call; `restoreVaultBackup`/`setup.ts`'s `restoreNewVault` re-partition that bundle back into the three tiers on write.
8. **Test suite pass** — every test file under `tests/unit/background/vault/**`, `tests/unit/background/identity/**`, and `tests/unit/shared/vault-schema.test.ts` gets rewritten against the new shapes. This is the largest-volume, lowest-risk step — mechanical once Steps 1–7 are right.
9. **Docs sync** — `docs/data-model.md`, `docs/security-model.md`, `docs/identity-model.md` get their storage-shape references corrected (they currently describe or imply the single-blob shape); `docs/plans/phase-2-local-identity-vault.md`'s M1/M3/M4/M5/M6/M7 sections each get a short "retrofitted by the tiering refactor, see ADR-015" pointer rather than being rewritten in place (preserve the historical record of what M1–M7 actually built, per this repo's existing convention of appending "as built" notes rather than editing milestone sections after the fact — M7's own section already does this).

## Execution prompts

Copy-paste each into a Claude Code session in order, one at a time, waiting for green `pnpm check` before the next. Each is self-contained (points back to this doc + ADR-015 rather than assuming prior conversation context), so they survive a context reset or a fresh session.

---

**Prompt 1 — Schema split**
> Read `docs/adr/ADR-015-three-tier-vault-storage.md` and `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 1. Implement the schema split in `shared/vault-schema.ts`: add `VaultIndexSchema`, `ServiceIdentityMetaSchema` (with a random `payloadStorageKey: string` field), and `SitePayloadSchema`, per the "Target shapes" section of the plan doc. Update `shared/messages.ts` payload/response types that reference the old `ServiceIdentityRecord`/`VaultData` shapes. Keep `VaultDataSchema`/`ServiceIdentityRecordSchema` in place for now (later steps still use them) but mark them `@deprecated` in a comment pointing at ADR-015. Run `pnpm check`; fix any type errors from the new exports. Commit as "Vault tiering Step 1: schema split (ADR-015)".

---

**Prompt 2 — Site payload key derivation**
> Read `docs/adr/ADR-015-three-tier-vault-storage.md` and `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 2. Add `background/vault/siteKey.ts` with `deriveSitePayloadKey(rootSecret: Uint8Array, origin: CanonicalOrigin): Promise<CryptoKey>`, mirroring `background/identity/derive.ts`'s structure (HKDF via `deriveHkdfBits` from `background/vault/crypto.ts`, `FixedAppSalt` via `getOrCreateFixedAppSalt`) but ending in `generateAesGcmKeyFromBits` instead of an Ed25519 import, with its own `info` constant distinct from `identity/derive.ts`'s and `keys.ts`'s existing personalization strings (domain separation). Write a unit test mirroring `tests/unit/background/identity/derive.test.ts`'s determinism checks (same root+origin → same key; different origin → different key — compare by encrypting a fixed plaintext and checking ciphertext equality/inequality, since `CryptoKey` isn't directly comparable). Run `pnpm check`. Commit as "Vault tiering Step 2: site payload key derivation".

---

**Prompt 3 — Storage layer rewrite**
> Read `docs/adr/ADR-015-three-tier-vault-storage.md` and `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 3 and the "Storage-key naming" table. Rewrite `background/vault/storage.ts` to expose three independent read/write surfaces for the index, personal-data, and site-payload tiers, per the plan doc. Reuse `background/vault/serialQueue.ts`'s `createSerialQueue()` — one instance for the index, one for personal data, and one per `payloadStorageKey` (created on demand, held in a module-level `Map`). Preserve existing error classes (`VaultLockedError`, `VaultNotInitializedError`, `VaultAlreadyInitializedError`) across all three surfaces. Do NOT touch `getCachedUnlockKey`/`setCachedUnlockKey`/`clearCachedUnlockKey` (the session-cached-bits mechanism from M3 is unaffected by this refactor). Leave the old whole-blob functions (`readVaultData`, `updateVaultData`, etc.) in place but unused for now — later steps remove their last callers. This step will not compile cleanly end-to-end yet since callers still expect the old API; that's expected — get `storage.ts` itself correct and its own new unit tests passing, don't chase every downstream type error yet. Commit as "Vault tiering Step 3: three-tier storage layer".

---

**Prompt 4 — Setup/unlock adaptation**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 4. Update `background/vault/setup.ts`'s `persistNewVault`/`restoreNewVault` to initialize the index tier and an empty personal-data blob (via the new `initializeVaultIndex`/`initializePersonalDataBlob` from Step 3) instead of the old single blob — no site payloads are created here (those come later, on first credential/alias save). Update `background/vault/unlock.ts`'s `unlockVault` to verify the derived key by decrypting the index tier instead of the old whole blob. Run `pnpm check` — expect remaining failures only in files Steps 5–7 haven't touched yet (`identity/*`, `vault/credentials/*`, `vault/personalData/*`, `vault/export.ts`). Commit as "Vault tiering Step 4: setup/unlock on the index tier".

---

**Prompt 5 — Identity module adaptation**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 5. Update `background/identity/{derive,storage,handler}.ts` so `getServiceIdentity`/`createServiceIdentity` read/write only the index tier (via Step 3's `readVaultIndex`/`updateVaultIndex`). `createServiceIdentity` must additionally mint a random `payloadStorageKey` (`crypto.randomUUID()`) and call the new `initializeSitePayload(payloadStorageKey, { origin, credentials: [], aliases: [] })` in the same logical operation it creates the index entry — keep the existing idempotency/fast-path behavior (skip entirely if the identity already exists) and the existing race-safety reasoning from M5's `createServiceIdentity` (capture-from-mutator-closure, not read-back-after-write). Update `tests/unit/background/identity/**` accordingly. Run `pnpm check`. Commit as "Vault tiering Step 5: identity module on index + payload tiers".

---

**Prompt 6 — Credentials + personal data adaptation, and old-API removal**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 6. Update `background/vault/credentials/{storage,handler}.ts`: `saveCredential`/`getCredentials`/`deleteCredential` resolve `payloadStorageKey` from the index (creating the identity + empty payload first if missing, keeping M6's existing self-sufficient-single-write reasoning) and then read/write only that site's Tier 3 blob — never the index's other entries or other sites' payloads. Update `background/vault/personalData/{storage,handler}.ts` to use `readPersonalDataBlob`/`updatePersonalDataBlob` from Step 3, preserving the existing patch-semantics (`undefined`-stripping) exactly. Once nothing references them, delete `VaultDataSchema`, `ServiceIdentityRecordSchema`, and `storage.ts`'s old whole-blob functions (`readVaultData`, `updateVaultData`, `updateVaultDataWithResult`, `initializeVaultData`) — grep the whole repo first to confirm zero remaining references before deleting. Update `tests/unit/background/vault/credentials/**` and `tests/unit/background/vault/personalData/**`. Run `pnpm check`. Commit as "Vault tiering Step 6: credentials + personal data on their own tiers; old whole-blob API removed".

---

**Prompt 7 — Export/restore adaptation**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 7. Update `background/vault/export.ts`'s `exportVaultBackup` to gather the index, the personal-data blob, and every site's payload (iterate the index's `serviceIdentities`, read each `payloadStorageKey`'s Tier 3 blob) into one flat plaintext bundle payload before encrypting with `BackupExportKey` — the envelope/KDF/bundle-format logic from M7 is otherwise unchanged. Update `restoreVaultBackup`/`setup.ts`'s `restoreNewVault` to re-partition the restored bundle back into the three tiers (fresh index write, fresh personal-data write, fresh site-payload writes with newly-generated `payloadStorageKey`s — do not try to reuse the original device's `payloadStorageKey` values, they're meaningless on the new device). Update `tests/unit/background/vault/export.test.ts`, keeping its existing coverage (round-trip identity check, wrong-passphrase rejection, corrupted-ciphertext rejection, the M7 concurrency regression test). Run `pnpm check`. Commit as "Vault tiering Step 7: export/restore across three tiers".

---

**Prompt 8 — Full test suite pass**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 8. Run `pnpm check` and `pnpm build` across the whole repo. Fix every remaining failure in `tests/unit/background/vault/**`, `tests/unit/background/identity/**`, and `tests/unit/shared/vault-schema.test.ts` against the new three-tier shapes — this should be mechanical at this point if Steps 1–7 were done correctly; if it's not mechanical (a test failure reveals a real design gap Steps 1–7 missed), stop and report the gap rather than papering over it with a test change. Confirm the final test count and report it. Commit as "Vault tiering Step 8: full test suite green on three-tier storage".

---

**Prompt 9 — Docs sync**
> Read `docs/plans/phase-2-vault-tiering-refactor.md`'s Step 9. Update `docs/data-model.md`, `docs/security-model.md`, and `docs/identity-model.md` wherever they describe or imply the old single-blob vault storage shape, to reflect the three-tier design in `docs/adr/ADR-015-three-tier-vault-storage.md`. In `docs/plans/phase-2-local-identity-vault.md`, add a short pointer note to the end of each of the M1, M3, M4, M5, M6, and M7 sections: "Retrofitted by the vault storage tiering refactor — see ADR-015 and `phase-2-vault-tiering-refactor.md`." Do not rewrite those milestone sections' original content — preserve them as the historical record of what was actually built at the time, matching this repo's existing convention (see M7's own "Implementation (as built)" subsection for the pattern). Commit as "Vault tiering Step 9: docs sync".

---
