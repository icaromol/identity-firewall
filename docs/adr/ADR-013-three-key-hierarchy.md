# ADR-013: A three-key hierarchy — VaultUnlockKey, RootSecret, BackupExportKey

## Status
Accepted

## Context
Neither [ADR-010](ADR-010-identity-derivation-function.md) nor [`security-model.md`](../security-model.md) cleanly separates three things that must be three *different* secrets with different lifetimes. If `VaultUnlockKey` and `RootSecret` were conflated (e.g. re-pairing a new passkey silently changed the HKDF `ikm`), every previously-derived Service Identity would become unrecoverable the moment the user changed how they unlock the vault — a severe, easy-to-introduce bug if not stated explicitly up front. This generalizes Attestto's own "device-unlock key ≠ backup key" lesson (`docs/research/attestto-teardown.md` §8, implication 3) one level further.

## Decision
Three cryptographically independent keys:

```text
VaultUnlockKey   — derived per-unlock from PRF or passphrase (ADR-012); AES-GCM key that
                   encrypts/decrypts the vault blob; session-cached only, never persisted,
                   rotatable (changing your unlock method must not touch anything below
                   this line)
      ↓ decrypts
RootSecret        — a CSPRNG-random value generated ONCE at setup, stored encrypted INSIDE
                   the vault blob (protected BY VaultUnlockKey, but not derived from it);
                   the HKDF ikm for every Service Identity derivation (ADR-010); must never
                   change for the lifetime of the vault, independent of how many times the
                   unlock method itself changes
BackupExportKey   — derived per export, from a separate backup passphrase via Argon2id
                   (ADR-012); encrypts only the export bundle; has no relationship to
                   VaultUnlockKey or RootSecret at all
```

## Consequences
- Changing or re-pairing the unlock method (new passkey, switching from PRF to passphrase or back) never invalidates any previously-derived Service Identity, because `RootSecret` never depends on `VaultUnlockKey`'s derivation path.
- A stolen backup file is decryptable only with its own export passphrase, independent of the live vault's current unlock method — compromising one never compromises the other.
- `background/vault/keys.ts` implements this as three separate functions (`deriveVaultUnlockKey`, `generateRootSecret`, `deriveBackupExportKey`) with no shared code path between them beyond the underlying Web Crypto/Argon2id primitives — the independence is structural, not just documented.
