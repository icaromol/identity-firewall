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

### WebAuthn integration mode: metadata-only for the MVP

Source-grounded research (`docs/research/webauthn-technical-notes.md`) settled a question this document previously left implicit: **can the extension actually "orchestrate" a passkey per Service Identity, and if so, how?** Two real, standards-based options exist:

- **Option A — metadata-only (chosen for the MVP, see [ADR-011](adr/ADR-011-webauthn-metadata-only-mode.md)):** the extension never intercepts or holds passkey key material. When a site's own JavaScript calls `navigator.credentials.create()`/`get()`, the OS/platform authenticator (Windows Hello, Touch ID, a hardware key) or the user's existing password manager handles the real ceremony, exactly as it would without this extension installed. Our job shrinks to recording, per Service Identity, *which* `rp.id`/credential ID pairing exists — a reference, never a private key — plus nudging the user toward using a passkey when one is available.
- **Option B — full custody (explicitly deferred):** the extension becomes its own software WebAuthn authenticator, generating and holding key material itself (a MAIN-world override of `navigator.credentials`, or Chrome's `chrome.webAuthenticationProxy`) — the same approach Bitwarden and 1Password ship today. This gives strict one-passkey-per-Service-Identity custody, but is a materially larger scope (CBOR/COSE encoding, sign-counter bookkeeping, a real race condition against other installed password managers under the MAIN-world approach, and a Chrome-only reliable path under the proxy approach) than "call an API and let the OS handle it."

Option A is what "Credential Manager" means with respect to passkeys everywhere else in this document and in [identity-model.md](identity-model.md) — see the footnote there on what a Service Identity's "passkeys" field actually holds under this mode.

One necessary correction to the legacy-mode pipeline below: **"does this site support WebAuthn" is not something the extension can ask the browser for free.** It can only be learned by being the interception layer (Option B) or by heuristically noticing a `navigator.credentials` call attempt / a "sign in with a passkey" UI element on the page. In practice this means the content script doesn't pre-classify a site as "legacy" vs. "WebAuthn-capable" up front — it falls through to password + alias generation whenever no WebAuthn ceremony materializes, on every page, every time.

### Native mode (future)

Sites that later choose to adopt a Private Identity SDK get a more direct path — cryptographic proofs and selective disclosure instead of form-filling:

```text
Website → SDK → Vault → cryptographic proof
```

This mode is where authentication and identity are formally decoupled (see the Authentication vs. Identity section in [architecture.md](architecture.md)), and where claim-based disclosures like "age over 18" without a birth date become possible. The SDK's API shape, protocol design, and adoption path are owned by `docs/interoperability.md` (sibling doc) — this document only notes where native mode sits relative to the legacy pipeline above: legacy mode is the default for essentially all of the web at launch, and native mode is additive, not a replacement it depends on.

## Engineering lessons carried over from the Attestto teardown

A source-level teardown of Attestto (`docs/research/attestto-teardown.md`) surfaced several implementation lessons worth adopting from day one rather than rediscovering the expensive way, since Attestto's own commit history documents having hit each of these as real, shipped bugs:

- **Design the message-passing router as capability-scoped from the start**, not a single giant `switch` over message-type strings. Attestto's own background script grew into a ~1,300-line switch before being refactored into a dispatch/composition-root pattern mid-project — cheaper to start with the smaller pattern than to retrofit it later.
- **Any pending-approval state (an authorization prompt waiting on the user) must be persisted to `chrome.storage.session`, never held in an in-memory variable.** MV3 can kill the background service worker after ~30 seconds idle; an in-memory `Map` of pending approvals loses its rows exactly when a user's "Approve" click arrives for a worker that no longer remembers the request.
- **Liveness/presence enforcement for a signature must live in a document context that can actually call WebAuthn/biometric APIs (e.g. the approval popup), never in the background service worker** — `navigator.credentials` doesn't exist there at all, making any background-side "proof of a live human" gate structurally decorative.
- **If a public/unencrypted metadata mirror is kept alongside the encrypted vault for fast, unlock-free reads, make it structurally impossible to update one without the other** (a single write path, or derive the mirror on read) rather than relying on developer discipline — Attestto's own two-vault split caused real "stale UI" bugs from a forgotten sync call.
- **Never let "trust an origin" silently expand into "auto-approve whatever that origin asks for next."** Attestto shipped exactly this as a trust-on-first-use optimization and reverted it after a security review; the corrected rule in its own operating notes is blunt: *"There is never an auto-accept. Literally never."* This is precisely the distinction the Policy Engine and Identity Firewall exist to enforce, so it's worth stating as an explicit constraint here too.
- **If a secret-sharing recovery scheme (e.g. Shamir) is ever built, split a random wrapping key that encrypts a full backup blob — never split the identity's raw private key directly.** Attestto's own first attempt split the bare signing key and shipped a real, named failure mode (a recovering user got a working signer with no credentials attached to present with it); their corrected design splits a disposable wrapping key instead.

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
