# ADR-007: No proprietary server dependency

## Status
Accepted

## Context
Related to but distinct from local-first key storage (ADR-001): even a local-first product can quietly become server-dependent if it relies on a company-operated API for core functions — for identity verification, for feature-gating, for "phoning home" to check licensing, etc. Since there is no company here, and the explicit goal is that the user shouldn't have to trust the author's infrastructure, this needs to be a deliberate constraint rather than an accident of how features get built.

## Decision
The product has no proprietary cloud/identity server it depends on. Ideally the MVP involves no server at all. Where a third-party integration is used for a specific piece of functionality (for example, email aliasing via SimpleLogin or addy.io), the integration must be swappable and self-hostable — never a hard dependency on "us" as a company, because there is no company.

## Consequences
- Every third-party integration decision (see `docs/competitive-landscape.md`) is evaluated against this constraint: does the user retain the ability to self-host or substitute the dependency? SimpleLogin and addy.io both qualify because they're open source and self-hostable.
- **"No server dependency" means no dependency on infrastructure *we* control — it does not mean "no third party anywhere in the picture."** Research into the email-alias integration (`docs/research/email-alias-integration.md`) confirmed self-hosting SimpleLogin/addy.io is unrealistic for a typical end user (both require a full mail-receiving stack: owned domain, MX/SPF/DKIM/DMARC, Docker, Postgres/MySQL) — so in practice, most users will point our optional Alias Manager at the *hosted* SimpleLogin.io or addy.io service. This remains consistent with this ADR precisely because: the integration is optional (the feature is inert with `provider: none`), the user supplies their own API key to an account *they* created, and the trust relationship is "the user chose to trust SimpleLogin-the-project," not "the user was forced to trust us." The load-bearing distinction is **who chose the dependency and whether it's optional** — not whether a third party exists anywhere in the picture at all.
- No feature should be designed such that it silently requires a server operated by this project's author to function — if a server-backed feature is ever proposed (e.g. optional encrypted sync), it must be opt-in, and the vault's core functionality must degrade gracefully to fully local operation without it.
- This is also what makes the "don't trust us — run it yourself, read the code, control your own keys" promise in `docs/product-vision.md` structurally true rather than just marketing language.
- This ADR is the practical extension of ADR-001 into "and don't reintroduce centralization at the integration layer either."
