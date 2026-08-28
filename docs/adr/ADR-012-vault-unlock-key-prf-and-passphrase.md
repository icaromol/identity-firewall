# ADR-012: Vault unlock key derivation — WebAuthn PRF primary, Argon2id-passphrase fallback secondary

## Status
Accepted

## Context
[`security-model.md`](../security-model.md) flagged this explicitly as "a genuinely open design question, not yet a final decision, and worth resolving explicitly before Phase 2 (Local Identity Vault) locks in the vault's unlock path": Attestto deliberately dropped a passphrase-based fallback KDF for their *live* unlock path, reasoning that a passphrase-derived key is indistinguishable from a passkey-derived one, which would make "passkey-protected" an unverifiable claim for their signature-centric product. Identity Firewall makes no marketed security claim to any third-party verifier ([`product-vision.md`](../product-vision.md) — a personal, local-first tool), so that reasoning does not transfer here.

What does transfer is the opposite risk: a hard PRF-or-nothing gate means a single user, on a single machine, with an authenticator that lacks PRF support (or that later fails or gets replaced), is **permanently locked out of their own vault** — no support desk, no account-recovery flow. For a solo local-first tool, that is the worse failure mode.

## Decision
Ship both. WebAuthn PRF stays the primary, recommended path (Attestto's production-validated pattern, ties unlock to the OS-native biometric per [`biometric-model.md`](../biometric-model.md) Model A). A passphrase-derived fallback is added as an explicit, user-chosen secondary path, using the *same* KDF as backup-export ([ADR-013](ADR-013-three-key-hierarchy.md)'s sibling decision) so there is exactly one non-native-Web-Crypto KDF in the codebase, not two.

```text
Passkey path:     HKDF-SHA256(ikm=prfOutput, salt=FixedAppSalt,
                    info='identity-firewall:vault-unlock:passkey:v1') -> AES-256-GCM key

Passphrase path:  Argon2id(password=passphrase, salt=FixedAppSalt,
                    personalization='identity-firewall:vault-unlock:passphrase:v1',
                    params=t/m/p recorded per-vault) -> AES-256-GCM key
```

The vault's decrypt logic is agnostic to which path produced the key — it only ever receives a raw `CryptoKey`, never a marker of how it was obtained.

**Reusing `FixedAppSalt` as the Argon2id salt for the passphrase path is deliberate, not an oversight.** `FixedAppSalt`'s only required property is uniqueness-per-installation ([ADR-010](ADR-010-identity-derivation-function.md)), which it already satisfies — Argon2id salts don't need to be secret for security to hold here, and a dedicated second persisted salt would add storage and complexity for no confidentiality benefit. What actually prevents collision between this derivation, the passkey-HKDF derivation, and every future per-origin Service Identity derivation ([ADR-010](ADR-010-identity-derivation-function.md)) that also uses `FixedAppSalt` is that each call differs in `ikm` and/or `info`/`personalization` — never in the salt alone.

**Argon2 cost parameters (`t`/`m`/`p`) are recorded per-vault** (`RootIdentitySchema.passphraseArgon2Params`), not read from a hardcoded default at unlock time. This mirrors [ADR-010](ADR-010-identity-derivation-function.md)'s own "never regenerate `FixedAppSalt`" rule, applied to Argon2's cost dial instead of its salt: if the default parameters are ever retuned in a later release, an existing vault's passphrase-unlock keeps using the parameters it was actually set up with, so it never silently becomes unlockable only under stale assumptions.

## Consequences
- A passphrase fallback is exactly as offline-brute-forceable as the backup-export file already is (same KDF, same reasoning) — it introduces no new attacker surface.
- The setup UI (Phase 2 M4) must present the trade-off explicitly — PRF strongly recommended — not offer both paths as equivalent.
- `RootIdentitySchema` carries an optional `passphraseArgon2Params` field, populated only when passphrase-unlock is configured, so a future change to `DEFAULT_ARGON2_PARAMS` never strands an existing vault.
- If Web Crypto's PRF extension output and the Argon2id passphrase path ever need to be distinguished operationally (e.g. security auditing, key rotation), the `info`/`personalization` tags already make each derivation's provenance unambiguous even though the resulting key format is identical.
