# Architecture

Identity Firewall is a **local-first, open-source, privacy-first** system that sits between a person and the websites they use. It replaces "Login with Google/Apple/Microsoft" and the accompanying pile of reused passwords with a locally-controlled identity that is compartmentalized per service.

This document describes the overall system architecture: the conceptual layered model, the concrete MVP architecture actually being built, the non-negotiable rules the design is built around, and the trust boundaries that every other design decision has to respect. Detailed breakdowns live in the sibling docs linked throughout — this page is the map, not the territory.

## Core rule

> **The server never holds the private key.**

Ideally, in the MVP, there is no server at all. There is no proprietary backend, no hosted "Identity Vault as a service," and no account with this project's author. Everything — key generation, encryption, policy decisions, credential storage — happens on the user's device. Where an MVP needs *some* external service (e.g., email alias forwarding), it is treated as an optional integration with an existing open-source project (see [browser-architecture.md](browser-architecture.md)), never as a dependency baked into the core.

This single rule is the thread that connects every diagram below: nothing in this architecture should require trusting a party other than the user's own device.

## Conceptual layered architecture

This is the original, idea-level shape of the product: an Identity Wallet at the core, branching into the technologies that back it, feeding into a Privacy Layer that is the only thing any given site actually talks to.

```text
                    USER
                     │
             ┌───────▼───────┐
             │ Identity Wallet│
             └───────┬───────┘
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
   Passkeys        VC/DID       Recovery
       │             │             │
       └─────────────┼─────────────┘
                     ▼
              Privacy Layer
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      Site A       Site B       Site C
     identity A   identity B   identity C
```

Read this diagram as a statement of intent rather than a literal module list: Passkeys (WebAuthn), Verifiable Credentials/DIDs, and Recovery are three pillars that the Identity Wallet is built from; the Privacy Layer is the enforcement point that decides what, if anything, crosses from the wallet to any individual site. Site A/B/C each see a distinct, non-correlatable identity — never the same identifier, never the root identity.

This picture predates the concrete MVP design below and is deliberately more abstract — VC/DID and general "Recovery" as drawn here are aspirational; the MVP narrows them down considerably (see [roadmap.md](roadmap.md)).

## The concrete MVP architecture

As the design was pressure-tested, it converged into a specific, buildable pipeline. This is the architecture actually being implemented in the near term:

```text
                 Browser Extension
                        │
             ┌──────────▼──────────┐
             │  Identity Firewall  │
             └──────────┬──────────┘
                        │
               ┌────────▼────────┐
               │  Policy Engine  │
               └────────┬────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
      Alias          Credential     Identity
      Manager         Manager        Manager
          │             │             │
          └─────────────┼─────────────┘
                        ▼
                 Local Encrypted
                      Vault
                        │
                  Biometric Auth
                        │
                 Device / OS
```

Reading it top to bottom:

- **Browser Extension** — the only interface between the user and the rest of the system in the MVP. Detects what a site is asking for. See [browser-architecture.md](browser-architecture.md) for the extension's own internal layering (content script / background service / popup) and technology stack.
- **Identity Firewall** — the component the whole product is named for. It intercepts data requests from a site before anything is disclosed and is the single choke point through which every field-level decision passes.
- **Policy Engine** — holds the rules ("email → alias by default," "CPF → always ask + biometrics") that let the Firewall auto-decide the common cases and only interrupt the user for the exceptions. Full behavior, including the Privacy Ledger it writes to, is in `docs/privacy-model.md` (sibling doc).
- **Alias Manager / Credential Manager / Identity Manager** — the three managers that actually produce what gets handed to a site: an email/data alias, a credential (password or passkey), or a per-service identity record.
- **Local Encrypted Vault** — where all of the above is persisted, encrypted at rest. See [data-model.md](data-model.md) for its internal structure and `docs/security-model.md` (sibling doc) for the encryption details.
- **Biometric Auth** — gates access to sensitive vault operations. It authorizes; it is never itself the identity or the data. See [identity-model.md](identity-model.md) and `docs/biometric-model.md` (sibling doc).
- **Device / OS** — the trust anchor. Everything above this line lives and dies with the device; nothing above it is meant to depend on a remote party.

Everything to the left of "Device / OS" runs on the user's machine. There is no box in this diagram for "our server," because in the MVP scope there isn't one.

## Authentication vs. Identity: a deliberate separation of concerns

A recurring design decision throughout the source brainstorm is to decouple two questions that most login flows conflate:

- **Authentication** — "Prove you hold this credential." A site asks "is this the same person who registered?" and gets back a cryptographic proof, nothing more.
- **Identity** — "Who are you?" A site asks for actual attributes — name, email, date of birth — and that's a separate, explicit disclosure decision.

Concretely, a login can complete with only:

```text
✓ Authentication proof
```

— no name, no email, no root identity — while a signup flow is the point where identity attributes are deliberately, individually authorized. This separation is why the Identity Firewall's consent UI treats "prove it's you" and "tell the site who you are" as different operations with different defaults, and it's the reason the roadmap treats a future **Private Login Protocol** (authentication-only, cryptographic) as a distinct milestone from **Selective Disclosure** (identity-attribute-only). See [identity-model.md](identity-model.md) for how the Root Identity / Service Identity split enforces this, and `docs/threat-model.md` (sibling doc) for how this separation limits blast radius when a site is compromised.

## Trust boundary

Every design decision in this project has to be checkable against a single diagram: what is inside the device, and what — if anything — is allowed to cross into the internet.

```text
┌─────────────────────────────┐
│          DEVICE             │
│                             │
│  ┌───────────────────────┐  │
│  │      IDENTITY VAULT   │  │
│  │                       │  │
│  │ Private Keys          │  │
│  │ Personal Data         │  │
│  │ Credentials           │  │
│  └───────────┬───────────┘  │
│              │              │
│       Identity Firewall     │
│              │              │
└──────────────┼──────────────┘
               │
               ▼
            INTERNET
```

Private keys, personal data, and credentials never leave the Identity Vault directly — the Identity Firewall is the only gate between the vault and the internet, and everything that crosses that gate is the result of an explicit, logged authorization (see the Privacy Ledger in `docs/privacy-model.md`, sibling doc). Any future diagram in this project that introduces a new boundary (a sync mechanism, a recovery device, an SDK call to a website) should be held to the same standard: state explicitly what data, if any, crosses it, and why that is the minimum necessary.

Note that this boundary protects *identity and account data*, not the network layer. IP address, browser fingerprint, DNS queries, and general network traffic sit outside this diagram entirely and are explicitly **not** something the Identity Firewall claims to protect — see `docs/threat-model.md` and `docs/privacy-model.md` (sibling docs) for the "what we protect vs. what we don't" boundary and the recommended complementary tools (VPN/Tor/hardened browser) that address the network and device layers this project deliberately stays out of.

## Architectural evolution path

The system is designed to deliver value at every stage rather than requiring the "final internet" to exist before it's useful. The end-to-end sequence, from where the web is today to a fully native ecosystem, is:

```text
Current Internet
      │
      ▼
Identity Firewall
      │
      ▼
Local Identity Vault
      │
      ▼
Biometric Authorization
      │
      ▼
Private Identity
      │
      ▼
Selective Disclosure
      │
      ▼
Private Login Protocol
      │
      ▼
SDK
      │
      ▼
Ecosystem
```

Each stage is a superset of the previous one's guarantees:

1. **Identity Firewall** works on today's web, with zero cooperation from sites — it intercepts forms on ordinary login/signup pages. See [browser-architecture.md](browser-architecture.md) for the "legacy web compatibility" pipeline that makes this possible.
2. **Local Identity Vault** gives that firewall a durable, encrypted, per-service identity model instead of ad hoc form-filling. See [identity-model.md](identity-model.md) and [data-model.md](data-model.md).
3. **Biometric Authorization** adds a local unlock mechanism gating sensitive disclosures — never sending biometric data anywhere (`docs/biometric-model.md`, sibling doc).
4. **Private Identity** and **Selective Disclosure** introduce claim-based, minimal-disclosure proofs (e.g., "age over 18" without a birth date) building on standards like SD-JWT.
5. **Private Login Protocol** formalizes authentication as a stand-alone cryptographic proof, decoupled from identity attributes (see the Authentication vs. Identity section above).
6. **SDK** lets sites that choose to adopt this project's protocol natively call it directly, instead of relying on the extension's legacy-compatibility layer.
7. **Ecosystem** is the end state where enough sites support the native protocol that the extension's legacy form-filling becomes the exception rather than the rule.

This is a roadmap-shaped diagram, not an architecture-shaped one — the phase-by-phase timeline, week estimates, and go/no-go criteria for each step belong in `docs/roadmap.md`, and the native-protocol/SDK design details belong in `docs/interoperability.md` (both sibling docs). This document only asserts that the path is intentionally incremental and that nothing here requires the later stages to exist for the earlier ones to be useful on their own.

## Where the detail lives

This document is intentionally a map. For the substance behind each box:

- [identity-model.md](identity-model.md) — Root Identity → Service Identity derivation, correlation-attack boundaries, biometrics-as-unlock-not-identity.
- [data-model.md](data-model.md) — the vault's data tree, field sensitivity classification, and the Real/Alias/Synthetic/Nonsense/Deny response model.
- [browser-architecture.md](browser-architecture.md) — the extension's internal architecture, the legacy-compatibility pipeline, and the chosen technology stack.
- `docs/threat-model.md` (sibling doc) — the full attacker catalog (malicious site, compromised site, local malware, device theft, product vulnerabilities, correlation attacks) and what each layer of this architecture does and does not mitigate.
- `docs/security-model.md` (sibling doc) — encryption at rest, key management, and extension permission boundaries.
- `docs/privacy-model.md` (sibling doc) — the Policy Engine's decision rules and the Privacy Ledger.
- `docs/biometric-model.md` (sibling doc) — the biometric-unlock design in full, including the deferred biometric-cryptography research track.
- `docs/roadmap.md` and `docs/interoperability.md` (sibling docs) — phase-by-phase timeline and the native SDK/protocol design.
