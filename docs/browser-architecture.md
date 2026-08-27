# Browser Architecture

This document describes the browser extension itself: its internal component layering, the pipeline that lets it work on today's web without any site cooperation, and the concrete technology stack chosen for it. For the system-level view this fits into, see [architecture.md](architecture.md); for what's stored and how it's classified, see [data-model.md](data-model.md) and [identity-model.md](identity-model.md).

## Extension architecture

The extension is the only interface between the user and the rest of the system in the MVP — there is no companion server, and the "backend" is entirely local to the browser process.

```text
┌──────────────────────────────────┐
│           Browser                │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Content Script             │  │
│  │                            │  │
│  │ Detect forms / fields      │  │
│  └─────────────┬──────────────┘  │
│                │                 │
│  ┌─────────────▼──────────────┐  │
│  │ Background Service         │  │
│  │                            │  │
│  │ Firewall / Policy Engine   │  │
│  └───────┬─────────┬──────────┘  │
│          │         │             │
│          ▼         ▼             │
│       Vault      Identity        │
│                                  │
│  ┌────────────────────────────┐  │
│  │ Popup / UI                 │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

- **Content Script** — runs in the context of the page, detects forms and fields as the user navigates a site. This is the only piece of the extension that ever touches page content directly.
- **Background Service** — hosts the Identity Firewall and the Policy Engine. This is where the actual decision logic lives: given what a content script detected, decide what should happen (auto-allow, alias, ask, deny) before anything is written back to the page.
- **Vault** and **Identity Manager** — the persistence and identity-derivation layers the background service reads from and writes to. See [data-model.md](data-model.md) for the vault's structure and [identity-model.md](identity-model.md) for how service identities are derived.
- **Popup/UI** — the surface the user actually interacts with: authorization prompts, the "what does this site know about me?" view, and settings. The Policy Engine's rules and the Privacy Ledger it writes are detailed in `docs/privacy-model.md` (sibling doc).

## Legacy web compatibility

The chicken-and-egg problem with any new identity protocol is that sites won't adopt it until users have it, and users have no reason to install it until sites support it. This project's answer is to make the extension work on **any existing site, with zero cooperation from that site**, by acting as a compatibility layer over the ordinary email+password web.

```text
Website
   │
   ▼
Form Detection
   │
   ▼
Field Classifier
   │
   ▼
Identity Firewall
   │
   ▼
Policy Engine
   │
   ▼
User Consent
   │
   ▼
Credential / Alias generation
   │
   ▼
Autofill
```

Walking the pipeline:

1. **Form Detection** — the content script notices a signup or login form on the page.
2. **Field Classifier** — each detected input is mapped to a semantic type (`email`, `national_identifier`, `birth_date`, etc.) and tagged with its apparent required/optional status — see [data-model.md](data-model.md) for why "optional" is treated as a hint, not ground truth.
3. **Identity Firewall** — the classified request is intercepted before anything is filled in or submitted.
4. **Policy Engine** — applies the sensitivity-based default rules (allow / alias / ask / ask+biometric) from [data-model.md](data-model.md); most requests are resolved automatically here without interrupting the user.
5. **User Consent** — the user is only prompted for the fields the Policy Engine didn't already have a rule for, or that are flagged sensitive/highly sensitive.
6. **Credential/Alias generation** — the Alias Manager, Credential Manager, and Identity Manager (see [architecture.md](architecture.md)) produce whatever the site actually needs: a generated email alias, a random password or passkey, a synthetic value, or nothing.
7. **Autofill** — the resulting values are written into the form fields exactly as if the user had typed them.

From the site's point of view, this looks like an ordinary account being created — it never has to know this system exists. That's the point: value is delivered on day one, on the web as it exists today, without waiting for any site to adopt anything.

### Native mode (future)

Sites that later choose to adopt a Private Identity SDK get a more direct path — cryptographic proofs and selective disclosure instead of form-filling:

```text
Website → SDK → Vault → cryptographic proof
```

This mode is where authentication and identity are formally decoupled (see the Authentication vs. Identity section in [architecture.md](architecture.md)), and where claim-based disclosures like "age over 18" without a birth date become possible. The SDK's API shape, protocol design, and adoption path are owned by `docs/interoperability.md` (sibling doc) — this document only notes where native mode sits relative to the legacy pipeline above: legacy mode is the default for essentially all of the web at launch, and native mode is additive, not a replacement it depends on.

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Extension framework | **WXT + Manifest V3** | Mature, cross-browser extension infrastructure — no reason to reinvent packaging/build tooling that already works. |
| UI | **TypeScript + Vue 3 + Tailwind + Pinia** | Straightforward, well-supported stack for a small, focused extension UI. |
| Cryptography | **Web Crypto API** (AES-GCM, ECDSA/EdDSA/P-256 signing, hashing, CSPRNG) | Never hand-roll cryptography — use the browser's audited, standard primitives for encryption, signing, hashing, and randomness. |
| Storage | **chrome.storage.local** (small state) + **IndexedDB** (larger structures) | Matches the size and access pattern of what's actually being stored — small config/state vs. larger vault structures. |
| Authentication | **WebAuthn / Credential Management API** | Passkeys are a mature, phishing-resistant standard — build on it rather than inventing a parallel authentication mechanism. |
| Validation | **Zod** | Schema validation for the data flowing between content script, background service, and UI. |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Standard, well-supported testing stack for a browser extension. |

### Relationship to Attestto's stack

Several of these choices deliberately mirror the stack used by Attestto Creds Extension, an existing open-source self-sovereign identity wallet extension studied as a reference during design: the extension framework (WXT/MV3), the UI stack (Vue 3, Tailwind, Pinia), the use of Web Crypto API for cryptography, and P-256 for signing. Attestto is treated as **a reference for implementation decisions that have already been tested in a shipped extension** — not as code to fork or a dependency to build on. The parts of this project that are actually novel (the Identity Firewall, the Policy Engine, the Privacy Ledger, per-field consent UX) are built independently. See `docs/competitive-landscape.md` (sibling doc) for the fuller comparison against Attestto and other adjacent projects (SimpleLogin, addy.io, AltMe).
