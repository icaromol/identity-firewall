# ADR-003: Use Web Crypto API, never hand-rolled cryptography

## Status
Accepted

## Context
The vault, service identities, credential signing, and (later) selective disclosure all depend on cryptographic primitives: key generation, symmetric encryption, signing, hashing, and secure randomness. Inventing cryptographic algorithms or protocols from scratch is a well-known source of catastrophic, hard-to-detect vulnerabilities, and this project has neither the resources nor the need to attempt novel cryptography for these primitives — mature, audited standards already exist.

## Decision
All cryptographic primitives — key generation, AES-GCM encryption, ECDSA/EdDSA/P-256 signing, hashing, and CSPRNG-based randomness — are implemented using the browser's **Web Crypto API**. No custom cryptographic algorithm is implemented for these purposes.

## Consequences
- Any cryptographic operation the vault needs is expressed as a composition of Web Crypto primitives, not a novel construction.
- Reference implementations (e.g. Attestto's use of P-256 + Web Crypto for signing — see `docs/competitive-landscape.md`) are studied for architectural decisions, but the actual cryptographic code path stays on the standard API surface.
- This decision is scoped to conventional cryptography. It does **not** cover biometric-to-secret derivation (fuzzy extractors, biometric cryptosystems), which is treated as a separate, deferred research question — see `docs/adr/ADR-005-biometric-as-unlock-not-secret.md`.
- If a future need genuinely can't be met by Web Crypto's primitive set, that gap should be researched and documented explicitly (as with the Phase 12 biometric R&D), not quietly worked around with ad hoc code.
