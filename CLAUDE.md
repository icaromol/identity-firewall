# CLAUDE.md

Standing instructions for any Claude Code session working on this repository. Phases 1–4 (extension foundation; local identity vault; the Identity Firewall itself; the Policy Engine and Privacy Ledger) are implemented and merged; Phase 5 (Vault Completion — personal data UI, password generation, credential capture/save/autofill, deterministic synthetic values) has not started — see `docs/roadmap.md` and `docs/plans/` for current status. The roadmap was restructured to insert Phase 5 (Vault Completion), Phase 6 (Extension Dashboard), and Phase 8 (In-Page Autofill & Auto-Login) after Phase 4; what were Phases 5–12 are now Phases 7, 9–15 respectively — always check `docs/roadmap.md`'s own phase numbers rather than assuming an older numbering from memory. Two honestly-documented real-world limitations from Phase 4's manual verification are carried forward, not fixed: dynamically-rendered forms (e.g. Figma's signup SPA) aren't detected at all, and multi-step wizard forms can silently fill a hidden/inactive step — both are Phase 9 ("Detection of dynamically rendered pages") territory now, not Phase 5's. Read this file fully before making architectural decisions or starting implementation.

## What this project is

Identity Vault / Identity Firewall is a **local-first, open-source, privacy-first browser extension**. It is a personal project belonging to one person — it is **not a company, not a startup, has no cloud backend, and is not seeking funding or users to acquire**. Its core idea is an "Identity Firewall": a layer that isolates the user's identity per website (a distinct identity, credential, and/or alias per service instead of one identity reused everywhere) and puts the user in explicit control of exactly what data each site receives. See `docs/product-vision.md` for the full rationale.

## The 7 non-negotiable principles

Defined before any technical architecture, specifically so implementation decisions can always be checked against them. Full rationale in `docs/product-vision.md` §5.

1. **Local-first** — identity and keys must function without any external server; no dependency on "our" server, API, account system, or infrastructure.
2. **User-owned** — keys and data belong to the user (`User → Device → Vault`, never `User → Our Cloud → Identity`).
3. **Minimization** — share the minimum necessary, and nothing more by default.
4. **Explicit consent** — sensitive data is never shared silently.
5. **Isolation** — every service gets an independent identity/credential whenever possible (`Site A ≠ Site B ≠ Site C`).
6. **Transparency** — the user must always be able to answer: who asked, what did they ask for, what did I hand over, when, and why.
7. **Don't promise anonymity** — never claim to hide IP address, fingerprinting, DNS, cookies, or network traffic. This product protects identity, not network privacy.

Any implementation decision that conflicts with one of these needs either a design change or an explicit ADR justifying the exception.

## MVP scope

Full phase-by-phase breakdown: `docs/roadmap.md`. At a glance:

### In scope
- Browser extension
- Local encrypted vault
- Root identity
- Service identities
- Unique credentials
- Form detection
- Field classification
- Required/optional detection
- Optional fields blocked by default
- User approval flow
- Real data responses
- Alias data responses
- Synthetic data responses
- Denial responses
- Sensitive-data classification
- Local biometric authorization
- Privacy Ledger
- Policy Engine
- Government/financial sensitive-site protection (safe mode)
- Backup/recovery
- No proprietary server dependency
- Open-source code
- Public threat model
- Explicit privacy limitations

### Out of scope (MVP)
- Blockchain
- Cryptocurrency/token
- VPN
- Tor
- Private DNS
- Custom browser
- Email server
- DID infrastructure
- Full Verifiable Credential ecosystem
- Custom biometric cryptography
- Cloud synchronization
- Proprietary identity server
- Mandatory SDK

## Chosen stack

Full rationale: `docs/browser-architecture.md`.

| Layer | Choice |
|---|---|
| Extension framework | WXT + Manifest V3 |
| Language | TypeScript |
| UI | Vue 3 + Tailwind + Pinia |
| Cryptography | Web Crypto API (never hand-rolled crypto) |
| Authentication | WebAuthn / Credential Management API |
| Storage | chrome.storage.local (small state) + IndexedDB (larger structures) |
| Validation | Zod |
| Testing | Vitest (unit) + Playwright (e2e) |
| Linting/formatting | Biome |
| Git hooks | Husky (pre-commit runs `pnpm check`: lint + type-check + unit tests) |

## How to treat reference projects

Full comparison: `docs/competitive-landscape.md`.

- **Attestto** (attestto-creds-extension) — study its architecture and decisions closely (vault structure, field-level consent, Web Crypto usage, MV3 lifecycle lessons — see `docs/research/attestto-teardown.md` for a real source-level teardown). Do not fork it or depend on it. Note: its pairwise-per-origin identities turned out to be random-generate-and-store, not a root-derived scheme — this project's own identity derivation (ADR-010) was designed independently, not adapted from Attestto's construction.
- **SimpleLogin / addy.io** — integrate via their API for email aliasing. Do not rebuild an email/SMTP/DNS stack.
- **WebAuthn** — use directly as the authentication substrate. Do not invent an alternative authentication ceremony.
- **AltMe / DID / VC** — study for future interoperability concepts only. Do not implement DID/VC infrastructure in the MVP (see `docs/adr/ADR-008-defer-did-vc-sdk.md`).
- **Justitia** — academic reference for future biometric-cryptography R&D (Phase 15). Never a production dependency (see `docs/adr/ADR-005-biometric-as-unlock-not-secret.md`).

## What's explicitly never being built in the core

See `docs/adr/` for the full reasoning behind each:

- No blockchain, cryptocurrency, or token (`ADR-006-no-blockchain.md`).
- No custom/hand-rolled cryptography (`ADR-003-web-crypto-not-custom.md`).
- No proprietary server dependency (`ADR-001-local-first.md`, `ADR-007-no-server-dependency.md`).
- No mandatory SDK for the MVP (`ADR-008-defer-did-vc-sdk.md`).

## Working instructions for Claude

- **Before making an architectural decision**, read the relevant doc(s) under `docs/` first. Don't re-derive decisions that are already made and documented.
- **If a new significant architectural decision is made**, add a new ADR under `docs/adr/` following the existing template (Status / Context / Decision / Consequences) rather than only describing it in a doc's prose. Number it sequentially after the existing highest ADR.
- **Treat `docs/archive/business-context.md` as historical only.** Never resurrect startup/business framing (pricing tiers, investor pitches, market sizing, growth metrics, CAC/retention-for-monetization) into product decisions unless the user explicitly asks to revisit that direction. See `docs/adr/ADR-009-personal-oss-project-not-startup.md`.
- **The source transcript** `Brainstorm-Briefing De Identidade Digital-20260827-0224.md` at the project root is the canonical raw source (in Portuguese) if any doc's fidelity to the original brainstorm is ever in question.
- Default to the simplest thing that satisfies the 7 principles above and the current phase in `docs/roadmap.md` — don't build ahead into later phases (e.g. don't reach for DID/VC or blockchain because they seem more "proper"; see the ADRs on why they're deferred/excluded).
- When touching cryptography, biometrics, identity derivation, or anything storage-related, check `docs/threat-model.md` and `docs/security-model.md` first — these define the attacker models and boundaries the implementation needs to satisfy.

## `docs/` index

- `docs/product-vision.md` — what the project is, the core problem, the three identity models, the 7 principles, the killer features, and the "don't promise anonymity" scope boundary.
- `docs/architecture.md` — overall system architecture and component responsibilities.
- `docs/identity-model.md` — root identity, per-service identity derivation, and how identities relate to each other.
- `docs/data-model.md` — the vault's data structures, field classification, and sensitivity levels.
- `docs/privacy-model.md` — data minimization, disclosure policy, and the Privacy Ledger design.
- `docs/security-model.md` — security boundaries, key management, and hardening decisions.
- `docs/threat-model.md` — attacker models (malicious site, compromised site, local malware, device theft, correlation attacks) and what is/isn't defended against.
- `docs/biometric-model.md` — biometric authorization design, Model A (unlock) vs. Model B (cryptographic secret derivation) and the R&D plan for the latter.
- `docs/browser-architecture.md` — extension internals (content script / background service / UI), the legacy-web-compatibility pipeline, and the chosen stack.
- `docs/interoperability.md` — legacy vs. native mode, the four-phase evolution, SD-JWT/selective-disclosure plan, deferred DID/VC, the future Private Login Protocol and SDK sketch, and why no blockchain.
- `docs/competitive-landscape.md` — survey of prior art (Attestto, SimpleLogin, addy.io, AltMe, Justitia, WebAuthn) and what to reuse vs. build.
- `docs/roadmap.md` — the phase-by-phase build plan (Phase 0–15), MVP scope checklists, and the strategic sequence/horizon.
- `docs/adr/` — 16 Architecture Decision Records (ADR-001 through ADR-016) covering local-first, browser-extension distribution, Web Crypto, pairwise service identities, biometrics-as-unlock, no-blockchain, no-server-dependency, deferred DID/VC/SDK, the personal-project-not-startup pivot, the finalized HKDF-based identity derivation function, the metadata-only WebAuthn integration mode, the vault unlock key's PRF-primary/Argon2id-passphrase-fallback derivation, the three-key hierarchy (VaultUnlockKey/RootSecret/BackupExportKey), the empirically-verified Ed25519 seed derivation for Service Identity keys, the three-tier vault storage split (index/personal-data/per-site payload) that scopes decryption to only what a given operation actually needs, and the deterministic per-site derivation of fake Synthetic personal-data values.
- `docs/archive/business-context.md` — historical, pre-pivot startup framing (market sizing, personas-as-customers, investors, GTM). Not active guidance.
- `docs/research/` — source-grounded technical research: `attestto-teardown.md` (a real clone-and-read teardown of Attestto's source, the basis for ADR-010 and ADR-011), `webauthn-technical-notes.md` (what a browser extension can and can't actually do with the WebAuthn API), `email-alias-integration.md` (SimpleLogin vs. addy.io API integration plan), `phase-1-tooling-scaffold.md` (current WXT/Tailwind tooling facts), `phase-1-runtime-architecture.md` (Phase 1's message-passing/module-boundary design). Treat these as grounding evidence for the ADRs and plans that cite them, not as a parallel spec — if a research doc and a main doc/ADR/plan ever disagree, the main doc/ADR/plan is current; the research doc explains why it says what it says.
- `docs/plans/` — detailed, phase-by-phase execution plans, one level more concrete than `docs/roadmap.md`'s phase objectives. Currently: `phase-1-extension-foundation.md` (milestones, directory tree, acceptance checklist for Phase 1 — complete), `phase-2-local-identity-vault.md` (milestones M1–M9 for the vault's crypto/storage/key-hierarchy design — complete), `phase-2-vault-tiering-refactor.md` (the sequenced, copy-paste-prompt execution plan for ADR-015's three-tier storage retrofit across M1–M7's already-shipped code — complete), `phase-3-identity-firewall.md` (milestones M1–M6 for the field classifier, response generator, approval UI, and autofill round-trip — complete), `phase-4-privacy-ledger-policy-engine.md` (milestones M1–M7 for the Policy Engine's resolution logic and the Privacy Ledger — complete), and `phase-5-vault-completion.md` (milestones M1–M7 for the personal data UI, password generator, credential capture/save/autofill, and deterministic Synthetic values — not started). Add a new file here, following the same pattern, before starting implementation on each subsequent phase.
- `docs/changelog/` — plain-language recap of each completed roadmap phase, one file per phase, generated by the `/phase-recap` skill as the readable companion to `docs/adr/` and `docs/plans/`.
