# Competitive Landscape / Prior Art

## Purpose

This project is personal, open-source software, not a company — so there is no "competition" in the commercial sense. What follows is a survey of existing open-source projects and platform standards that overlap with parts of the Identity Vault / Identity Firewall design, done to answer one question before writing code:

> **Do we need to build this from scratch, or can this project be an orchestration/UX/privacy-firewall layer on top of things that already exist?**

The conclusion from that survey: several pieces of this product already exist, scattered across different projects. No single project found combines all of them into the architecture this project targets — in particular, nothing does "detect what a site is asking for field-by-field, distinguish required vs. optional, let the user choose what to disclose" as an integrated, legacy-web-compatible UX. That gap is the actual differentiator, and it's covered in [`docs/product-vision.md`](./product-vision.md).

| Category | Number of projects | Closeness to our design |
|---|---:|---|
| Password managers | Many | 🟡 |
| Email aliases | Several | 🟢 |
| Passkeys | Many | 🟡 |
| Identity wallets | Several | 🟢 |
| SSI / DID | Many | 🟢 |
| Verifiable Credentials | Many | 🟢 |
| Selective disclosure | Several | 🟢 |
| Biometric → cryptographic key | A few | 🟢 |
| Browser identity extensions | A few | 🟢 |
| **Complete Identity Firewall** | **Very few** | 🔴 |
| **Identity + local biometric authorization + firewall + legacy-site compatibility, combined** | **No direct equivalent found** | 🔴 |

---

## Projects surveyed

### Attestto Creds Extension

**github.com/Attestto-com/attestto-creds-extension**

The closest conceptual match found. A self-sovereign identity wallet as a browser extension, open source, built with:

- Manifest V3, Vue 3, Pinia, Tailwind
- verifiable credentials with selective disclosure
- pairwise DID (`did:jwk`) generated per origin — a different identity per site
- field-by-field consent before any credential data leaves the vault
- an encrypted local vault: AES-256-GCM data in `chrome.storage.local`, with the decryption key kept separately in `chrome.storage.session`
- P-256 keys and Web Crypto API for signing
- Shamir's Secret Sharing (2-of-3) for recovery
- DIDComm v2 for messaging
- a bridge into `navigator.credentials` (the browser Credential Management API)

**Role in this project: primary architectural reference to study and adapt decisions from — not to fork or depend on.** Specific things worth a technical teardown: `background.ts`, `credential-api.ts`, `services/crypto`, `services/signing`, `services/shamir`, `utils/vault`, `trusted-origins`, and `site-identity-prefs`. The value isn't the code — it's that these are architectural decisions that have already been made and tested in a working extension: how the vault is structured, how per-origin identities are derived, how field-level consent is implemented, which browser APIs are used for what.

---

### SimpleLogin

**github.com/simple-login/app**

Open source, self-hostable email-alias service with its own browser extension. Positions itself explicitly as a privacy-first alternative to "Login with Google/Apple/Facebook." Solves exactly one layer of this project's design: a different email address per service, forwarding to the user's real inbox, revocable per-alias.

Its architecture (backend/webapp, browser extension, and a dedicated email-handling component with PostgreSQL and full SMTP/DNS infrastructure) is a full mail service, not a small library.

**Decision: integrate via its API — do not rebuild an email/SMTP/DKIM/DMARC stack.** Standing up mail infrastructure (SMTP, DNS, DKIM, SPF, DMARC, inbound handling, forwarding, spam/reputation management) is a large, orthogonal problem that SimpleLogin already solves and that this project gains nothing from re-solving in an MVP.

---

### addy.io

**addy.io**

Very similar in shape to SimpleLogin: a browser extension that generates an alias at signup time, and a self-hostable service behind it.

**Decision: integrate, don't rebuild** — same reasoning as SimpleLogin. Either service (or both, as interchangeable alias backends) covers the "email alias per service" piece without this project needing to operate mail infrastructure.

---

### AltMe

**github.com/TalaoDAO/AltMe**

An open-source sovereign identity wallet from TalaoDAO, built around the full W3C Verifiable Credentials / SSI standards stack: SD-JWT, OpenID4VCI (credential issuance), OpenID4VP (presentation), EUDI (the EU Digital Identity framework), on-device storage, and hardware/cryptographic interfaces.

AltMe is a much larger project than this one needs to be in its early phases, precisely because it takes on the full DID/VC/issuer/verifier/interoperability ecosystem. It's closer to general-purpose SSI infrastructure than to the "Identity Firewall" consent UX this project is building (per-site field classification, required vs. optional, real/alias/synthetic/deny responses).

**Decision: study for interoperability concepts only; do not implement DID/VC infrastructure in the MVP.** DID methods, resolution, document formats, registries, and issuer/verifier protocols are real complexity that this project explicitly defers — the goal is to design the local identity model so it *could* become interoperable with something like AltMe later, without needing that infrastructure now.

---

### Justitia

**github.com/euzun/justitia**

A research project, not a production tool. It derives a cryptographic key from biometric embeddings using fuzzy extractors, demonstrating that the same biometric input recovers the same secret while a different biometric input does not. It's genuine evidence that "biometric input → cryptographic secret" (rather than "biometric input → stored template") is a real, working line of research, not a naive idea.

**Decision: academic reference only — never a production dependency.** The MVP uses **Model A**: OS-native biometric authentication (fingerprint/face unlock provided by the operating system) purely to unlock the local vault. Biometric data never leaves the device and the product itself never sees it. **Model B** — a custom biometric-to-cryptographic-secret scheme in the style of Justitia, where the biometric itself derives a signing key rather than merely unlocking one — is deferred to a dedicated R&D phase (fuzzy extractors, secure sketches, cancelable biometrics, template protection, false-acceptance/false-rejection tradeoffs, reconstruction attacks). It should not be assumed safer than Model A by default; that needs its own investigation before any decision to adopt it.

---

### WebAuthn / Passkeys

A platform standard, not a competing product — this is the authentication substrate the project builds **on top of**, not around or instead of.

A passkey is a public/private key pair associated with a specific service (the server holds the public key; the authenticator holds the private key), with origin binding built into the standard itself. This maps directly onto the project's own per-service identity model:

```text
Site A → Passkey A
Site B → Passkey B
```

**Decision: reuse the standard as-is (WebAuthn / Credential Management API).** There is no reason to invent an alternative authentication ceremony — the vault's role is to *orchestrate* passkeys per service identity, not to replace the cryptography WebAuthn already provides.

---

## Reuse vs. build matrix

This is the decision grid used to scope the MVP: reuse mature, security-critical infrastructure wherever the cryptographic or protocol risk is high, and reserve custom engineering for the parts that are actually this project's differentiator.

| Component | Reuse | Study-and-build | Reason |
|---|---|---|---|
| Browser Extension | **WXT / Manifest V3** | — | Mature infrastructure; Attestto already runs on it |
| UI | **Vue 3 + Tailwind** | Our own UX | Simple, proven stack; the UX itself is ours |
| Vault | — | **Study Attestto's pattern, build our own** | We need full control of the data model |
| Cryptography | **Web Crypto API** | Our own thin layer on top | Never invent cryptography |
| Passkeys | **WebAuthn** | Integration only | Existing web standard |
| Identity-per-site | Study Attestto's `did:jwk` pairwise concept | **Build our own derivation** | Central to our differentiation — used as reference, not as a dependency |
| Email aliases | **SimpleLogin / addy.io** | Integration only | Don't reinvent email/SMTP/DNS |
| Selective disclosure | **SD-JWT concept** | Integrate later | Existing standard; structure the data model now so it can slot in later |
| VC / DID | Defer | Study only | Unnecessary complexity for the MVP |
| Biometrics | **Native OS APIs first** | Research own scheme later | The most delicate part — Model A now, Model B (Justitia-style) as R&D |
| **Identity Firewall** | — | **100% ours** | The actual product |
| **Privacy Ledger** | — | **100% ours** | The differentiator |
| **Policy Engine** | — | **100% ours** | The differentiator |

### The fully custom pieces

Three components are explicitly **100% ours** — not because reuse was rejected out of caution, but because nothing found in this survey solves them:

- **Identity Firewall** — the interceptor that detects a site's form, classifies its fields (type, apparent required/optional status), applies policy, and asks the user for a decision only when necessary.
- **Privacy Ledger** — the local, per-site history of exactly what was requested, what was disclosed, what was denied, and how (real/alias/synthetic), so the user can always answer "what does this site know about me?"
- **Policy Engine** — the rules layer that turns most interactions into automatic decisions (e.g. "email → alias by default," "phone → deny," "national ID → always ask + biometric authorization") so the user is only interrupted for genuinely new decisions.

These three are the reason this project exists rather than being a thin wrapper around Attestto, SimpleLogin, and WebAuthn.
