# ADR-010: Identity derivation function — HKDF-SHA256 over a normalized origin

## Status
Accepted

## Context
[identity-model.md](../identity-model.md) fixed the principle "one identity per origin, unlinkable across sites" but originally left the exact derivation mechanism unresolved ("needs careful design"). The obvious next step was to check whether Attestto — this project's closest architectural reference — had already solved this, since `docs/competitive-landscape.md` cites its `did:jwk` pairwise-per-origin identities as directly relevant prior art.

A source-level teardown (`docs/research/attestto-teardown.md`) found that Attestto does **not** derive per-origin identities from a root key at all: `generateSiteDid()` generates a fresh, independently-random P-256 keypair per origin via `crypto.subtle.generateKey()` and stores it forever in a `Record<origin, keypair>`, using the origin purely as a lookup key. Its own "root identity" is, for the same reason, just the first randomly-generated key — there is no HD/BIP32-style hierarchy anywhere in that codebase. So "Attestto already validated this" was not available as a basis for deferring our own design.

## Decision
Use a real deterministic derivation:

```
ServiceIdentityKeySeed = HKDF-SHA256(
  ikm  = RootSecret,
  salt = FixedAppSalt,          // fixed per installation
  info = normalizeOrigin(origin) // one canonical function, everywhere
)
```

The resulting seed deterministically seeds a per-origin ECDSA/Ed25519 keypair via the Web Crypto API (per [ADR-003](ADR-003-web-crypto-not-custom.md)).

`normalizeOrigin()` is a single canonical function used everywhere an origin is either a KDF `info` parameter or a storage key: `protocol//host`, lowercased, punycoded, default ports (`:443`/`:80`) stripped, non-default ports kept.

## Consequences
- **Recoverable from the root alone.** As long as `RootSecret` and the origin string are known, the exact same Service Identity key can be recomputed on a fresh device with no per-site backup — only the root needs to survive a device loss. This is the property Attestto's own generate-and-store approach lacks (losing its vault backup severs every per-site identity permanently).
- **Trade-off accepted deliberately**: Attestto's random-per-origin approach has a theoretical unlinkability edge (no shared mathematical relationship between per-site keys, even under a worst-case KDF break). HKDF's per-origin outputs are only as unlinkable as HKDF's own security properties hold and the root secret stays secret. This is a standard, well-understood assumption, and the recoverability property is judged worth it for a local-first, root-holds-everything product.
- `normalizeOrigin()` must be implemented once and used everywhere (KDF input and storage key) from the start — Attestto's own codebase had five independent copies of equivalent logic before consolidating; we should not repeat that.
- This decision is specific to *our own* per-service identity keys. It is unrelated to WebAuthn/passkey key material, which is never generated or held by this project under the MVP's integration mode — see [ADR-011](ADR-011-webauthn-metadata-only-mode.md).
