# ADR-014: Service Identity keys are Ed25519, imported from a seed via a PKCS8 wrapper

## Status
Accepted

## Context
[ADR-010](ADR-010-identity-derivation-function.md) says HKDF output "deterministically seeds a per-origin ECDSA/Ed25519 keypair... via the Web Crypto API." That phrasing turned out not to be literally implementable: `crypto.subtle.generateKey()` has no seed parameter for either algorithm — it is spec'd to use the browser's internal CSPRNG only, by design, precisely to prevent low-entropy or malicious seeding. For ECDSA/P-256, there is also no Web-Crypto-only path from a raw scalar to a full keypair: importing a private JWK requires the public coordinates (`x`, `y`) alongside `d`, and Web Crypto exposes no "compute the public point from a private scalar" primitive for NIST curves — doing that by hand is exactly the hand-rolled elliptic-curve math "never invent cryptography" ([ADR-003](ADR-003-web-crypto-not-custom.md)) rules out.

Ed25519 is different: per RFC 8032, an Ed25519 private key genuinely *is* a 32-byte seed — the public key and signing behavior are both deterministically derived from that seed by the algorithm's own definition, not by browser-internal randomness. This ADR narrows ADR-010's "ECDSA/Ed25519" phrasing to Ed25519 specifically, and records the concrete import mechanism verified empirically during M5 (ADR-010's own text is left as historical record, not edited).

## Decision
Commit to Ed25519. Verified empirically against real Web Crypto (Node's `webcrypto`, the same implementation Chromium uses, independently reproduced by a second verification pass):

- `crypto.subtle.importKey('raw', seed, 'Ed25519', ..., ['sign'])` — **fails**: "Unsupported key usage for Ed25519 key" (raw format is for public keys only).
- `crypto.subtle.importKey('jwk', {kty:'OKP', crv:'Ed25519', d}, ...)` without the public coordinate `x` — **fails**: "Invalid keyData."
- `crypto.subtle.importKey('pkcs8', <wrapped seed>, 'Ed25519', ..., ['sign'])` — **works**, where the seed is wrapped in the fixed, standard RFC 8410 §10.3 DER envelope for an unencrypted Ed25519 private key: a 16-byte prefix (`302e020100300506032b657004220420`, hex) followed by the raw 32-byte seed, 48 bytes total. This is data encoding — constructing a publicly-documented ASN.1 structure — not hand-rolled cryptography; Web Crypto performs every actual cryptographic operation (key validation, scalar clamping, public-point computation, signing).

No `@noble/curves` fallback is needed.

**Both halves of the derived keypair are deterministic**, confirmed two independent ways: the exported public key is byte-identical across repeated imports of the same seed, and Ed25519 signing is itself deterministic — signing the same message with two independently-derived private keys from the same seed produces byte-identical signatures. Also confirmed: sign/verify round-trips correctly; a tampered signature is correctly rejected; a **non-extractable** private key still signs correctly; different seeds produce different keys.

**Getting the derived public key's raw bytes requires one extra step Web Crypto has no shortcut for**: there is no "compute the public key from a private key" primitive. The only path found: import the private key as `extractable: true`, `exportKey('jwk', ...)` to read its `x` field (the public key, base64url-encoded per JWK spec), then discard that momentarily-extractable key and re-import a fresh `extractable: false` private key from the same seed for actual use. This is confined to `background/identity/derive.ts` and the extractable key is never returned or persisted.

## Consequences
- `background/identity/derive.ts` is the one place in the codebase this PKCS8-wrapping technique lives — not promoted to `background/vault/crypto.ts` (which stays algorithm-agnostic), since nothing else needs Ed25519-specific key construction.
- No new dependency: Web Crypto alone is sufficient, keeping the "never invent cryptography" boundary exactly where ADR-003 draws it — no elliptic-curve math is implemented by this project, only a fixed-format envelope around bytes Web Crypto itself validates and uses.
- **The private key is never persisted anywhere** — only the derived public key (`identifierB64`) goes into `ServiceIdentityRecord`. Any future signing use (Phase 3's Identity Firewall, most plausibly) must **re-derive** the private key on demand via `deriveServiceIdentityKeypair(rootSecret, origin)` every time it's needed, never fetch a cached `CryptoKey` from storage — exactly consistent with ADR-010's "recoverable from root alone" property, but a real per-operation cost (one HKDF derivation + one PKCS8 import + one sign) worth budgeting for up front rather than discovering as a surprise.
- [`security-model.md`](../security-model.md) and [`identity-model.md`](../identity-model.md), which described the signing algorithm as "ECDSA/EdDSA (P-256 or equivalent, where supported)"/"ECDSA/Ed25519," are corrected to name Ed25519 specifically.
