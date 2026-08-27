# ADR-004: Pairwise service identities derived from a root identity

## Status
Accepted

## Context
Under the centralized-login model, one identity provider account underlies access to potentially hundreds of services, so compromising or correlating that one account has systemic reach. The project's stated goal is to reduce this blast radius: compromise of one service's credentials should not cascade to others, and sites should not be able to trivially discover that "identity A on site X" and "identity B on site Y" are the same person.

## Decision
A distinct identity is derived per service/origin from a root identity. The root identity is never exposed to sites — only the derived, service-specific identity is.

```text
ROOT IDENTITY
      │
      ├── Service Identity (github.com)
      ├── Service Identity (reddit.com)
      └── Service Identity (discord.com)
```

## Consequences
- If one service's identity/credential is compromised, the other service identities and the root identity must remain unaffected — this "blast-radius test" is a concrete acceptance criterion for the vault's design (see `docs/identity-model.md` and `docs/threat-model.md`).
- Sites cannot use the identity itself as a correlation key across services. This is **identity isolation**, not full anonymity — correlation via IP, fingerprinting, shared email, or behavioral patterns is a separate problem this decision does not solve (see `docs/privacy-model.md` and the "don't promise anonymity" principle).
- The derivation scheme (root → per-origin identity) is one of the project's genuinely custom pieces. A source-level teardown of Attestto (`docs/research/attestto-teardown.md`) found its `did:jwk`-per-origin identities are actually random-generate-and-store, not a root-derived scheme — so this project's HKDF-based derivation (see [ADR-010](ADR-010-identity-derivation-function.md)) was designed independently rather than adapted from Attestto's construction, precisely because it's central to the project's differentiation rather than infrastructure to be reused as-is.
- Attribute disclosure is scoped per service identity, not per root identity: each service identity carries only the attributes it has actually been authorized to hold.
