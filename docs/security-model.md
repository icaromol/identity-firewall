# Security Model

This document describes **how** Identity Firewall is technically secured: the cryptographic building blocks it uses, the authentication mechanism it builds on, and the boundaries drawn around the MVP's own security posture. It deliberately does not restate *what* the system protects against *whom* — that is [threat-model.md](threat-model.md), attacker by attacker — nor *what* data policy governs disclosure — that is [privacy-model.md](privacy-model.md). This document is the "how it's built to survive Attacker E" (a vulnerability in our own product) and "how the crypto behind Attacker B/D's mitigations actually works" companion to those two.

## Never invent cryptography

This is a categorical rule, not a preference: **the project does not design its own cryptographic primitives.**

Everywhere the system needs a cryptographic operation, it uses the browser-native **Web Crypto API**:

- key generation;
- **AES-GCM** for symmetric encryption (the Vault's encryption-at-rest);
- **ECDSA/EdDSA** (P-256 or equivalent, where supported) for signing;
- hashing;
- a cryptographically secure random number generator (CSPRNG) wherever randomness is needed (e.g. generating alias values).

The reasoning is simple: cryptographic implementations are one of the easiest places for a small, well-intentioned team to introduce a catastrophic bug. Reusing a browser's audited, standardized implementation removes an entire class of risk that a from-scratch implementation would carry, in exchange for essentially no loss of capability for what this product needs to do.

**Prior art, not a dependency:** the Attestto Creds Extension (a browser-based self-sovereign identity wallet) already validates that this exact pattern — Web Crypto API plus P-256 for signing, inside a Manifest V3 extension — works in production-shaped code. It is referenced here as evidence the approach is sound, and as a project worth studying for its architecture. It is explicitly **not** a runtime or build-time dependency of this project. See [competitive-landscape.md](competitive-landscape.md) for the fuller comparison of what is studied versus what is built from scratch.

## Vault unlock key: derived, never stored

The Vault's AES-GCM encryption key is never persisted at rest as itself — it's re-derived on every unlock and cached only in `chrome.storage.session` (RAM-only, cleared on browser close or explicit lock), the same pattern validated in production by Attestto (`docs/research/attestto-teardown.md`): a WebAuthn PRF-extension output is run through HKDF-SHA256 with a fixed `info` string and a random per-installation salt to produce the AES key, so the key material never touches persistent storage in derived form.

This question is now resolved by [ADR-012](adr/ADR-012-vault-unlock-key-prf-and-passphrase.md): Attestto deliberately dropped a passphrase-based fallback KDF for their *live* unlock path, reasoning that a passphrase-derived key is indistinguishable from a passkey-derived one and would make "passkey-protected" an unverifiable claim for their signature-centric product. Identity Firewall's vault does not carry that exact same claim, so a passphrase fallback (for devices/authenticators without PRF support, or for accessibility) is shipped as a deliberate, documented secondary path — see ADR-012 for the exact derivation and why it's a safe divergence. Argon2id (not PRF/HKDF) remains the right KDF for any *offline backup export*, independent of this question, since a backup file has no live authenticator to derive a PRF from — and is in fact the same KDF the passphrase-unlock fallback itself uses, per ADR-012.

## Authentication: Passkeys / WebAuthn

The project does not build its own authentication protocol. It builds on **WebAuthn/FIDO2 passkeys**, the existing web standard for public-key authentication:

- the browser/authenticator generates a standard public/private key pair **per relying party** (i.e., per site);
- the relying party's server stores only the **public key**;
- the **private key** never leaves the authenticator.

This maps directly onto the product's core idea of a distinct identity per service (see [identity-model.md](identity-model.md)): WebAuthn's per-relying-party key pair is, structurally, the same shape as a Service Identity. The Vault's job is to orchestrate and store these credentials locally, not to reimplement what WebAuthn already does correctly. Nothing about Service Identity Isolation ([threat-model.md](threat-model.md), Attacker B) requires a custom authentication scheme — it requires applying the existing per-origin passkey model consistently and pairing it with the Vault's own per-service data partitioning.

## Minimizing the extension's own attack surface

Because Attacker E in the threat model ("a vulnerability in our own product") is treated as a certainty to design around rather than a hypothetical, the extension's attack surface is a first-class security control, not just a philosophical stance toward minimalism:

- **minimal permissions** — the extension requests only the browser permissions it actually needs to detect forms, intercept submissions, and manage credentials; broad host permissions or unnecessary API access widen exactly the surface Attacker E would exploit;
- **no unnecessary network calls** — the MVP avoids a backend by design (see [architecture.md](architecture.md)'s core rule that the server never holds the private key), and any external call that does exist (e.g. an alias-provider integration) is an explicit, auditable exception rather than a default network posture;
- **encrypted-at-rest Vault** — private keys, personal data, and credentials are never persisted in plaintext, so a partial compromise (e.g. read access to extension storage without code execution) does not itself disclose Vault contents;
- **an auditable, open-source codebase** — this is treated as an actual security control, not a marketing statement: because there is no proprietary server and no hidden logic, independent reviewers can verify every claim made in this document and in [threat-model.md](threat-model.md) against the real implementation. Trust is meant to be earned through inspection, not asserted.

## MVP security scope: what is explicitly out

To keep the security model something that can actually be reasoned about and reviewed at this stage, the following are explicitly **not** part of the MVP's security design. They are deferred, not rejected — see [roadmap.md](roadmap.md) for when/whether they resurface, and the project's ADRs for the reasoning behind each exclusion:

- blockchain or any token/ledger infrastructure;
- DID (Decentralized Identifier) infrastructure and resolution;
- full Verifiable Credentials (issuer/holder/verifier flows, OpenID4VC, etc.) — selective disclosure is the target concept, but VC as a complete protocol stack is deferred (see [privacy-model.md](privacy-model.md) for what selective disclosure means in the MVP instead);
- custom biometric cryptography (deriving secrets directly from biometric input) — see [biometric-model.md](biometric-model.md) for why this is a distinct, explicitly deferred R&D track;
- cloud sync of any kind;
- a proprietary identity server — there is no "Identity Firewall cloud" to compromise, by design.

Each of these reappears in the relevant ADR (e.g., ADR-006 No Blockchain, ADR-007 No Custom Crypto, ADR-008 No Server Dependency) with the specific reasoning recorded at the time of the decision. The security model described in this document is scoped to what the MVP actually is: a local extension, a local encrypted Vault, WebAuthn-based authentication, and Web-Crypto-based cryptography — nothing more, and nothing invented.
