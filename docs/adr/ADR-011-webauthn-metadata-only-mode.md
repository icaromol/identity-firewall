# ADR-011: WebAuthn integration is metadata-only for the MVP

## Status
Accepted

## Context
The original brainstorm assumed the extension would "orchestrate" a passkey per Service Identity as one capability alongside aliases and passwords, without specifying the mechanism. Dedicated research (`docs/research/webauthn-technical-notes.md`) into the WebAuthn/Credential Management API establishes what's actually possible:

- A credential's `clientDataJSON.origin` is filled in by whatever code actually executes `navigator.credentials.create()`/`get()`. If our extension's own background/popup calls it directly, the origin recorded is the extension's own (`chrome-extension://…`), which an unmodified relying-party server will reject — this requires site cooperation and breaks the zero-cooperation legacy-mode goal.
- The only two standards-grounded ways for an extension to answer a WebAuthn ceremony for an arbitrary site with zero cooperation both require the extension to **become its own software WebAuthn authenticator**: a MAIN-world override of `navigator.credentials` (Bitwarden/1Password's approach, with a documented race condition when two such extensions are installed), or Chrome's `chrome.webAuthenticationProxy` (Chrome-only, one attached extension at a time).
- In both cases, the extension would generate and hold real key material itself (via Web Crypto) — it does not "help the OS authenticator along." A real platform authenticator's private key (Windows Hello, Touch ID) never leaves the OS/hardware under any circumstance; no API exposes it to any application.
- Critically, none of this applies to a site with no client-side WebAuthn code at all (a plain email+password form) — there is nothing to intercept there regardless of which path is chosen.

## Decision
Ship the MVP with **metadata-only** WebAuthn integration: the extension never intercepts or holds passkey private-key material. When a site's own JavaScript calls the WebAuthn API, the OS/platform authenticator (or the user's existing password manager) performs the real ceremony exactly as it would without this extension installed. The extension's role is limited to:
1. noticing, heuristically, that a site offers passkey signup/login (there is no free, non-interception way to know this for certain — see the research doc, §7–8);
2. recording, per Service Identity, which `rp.id`/credential-ID pairing exists, as a reference — never a private key;
3. nudging the user toward using a passkey when one is available, and providing autofill/UX orchestration around that metadata.

Becoming a full software WebAuthn authenticator (custody of key material, CBOR/COSE encoding, sign-counter bookkeeping) is explicitly deferred to a later, separately-scoped phase — not folded silently into "Credential Manager, does passwords and passkeys" as originally implied.

## Consequences
- [identity-model.md](../identity-model.md)'s "Service Identity holds: … passkeys" line means *reference*, not custody, under this decision — see the footnote added there.
- [security-model.md](../security-model.md)'s vault-contents description is accurate as-is: the vault never becomes the thing an attacker wants for passkey key material, because it never holds any. If a future phase adopts full custody (Option B), this file and the threat model both need revisiting, since the vault's risk profile changes materially at that point.
- The "zero-cooperation legacy mode" claim in [browser-architecture.md](../browser-architecture.md) is unaffected and confirmed correct: for sites with no client-side WebAuthn code, password + alias generation remains the only available mechanism at any integration tier, with or without this decision.
- If strict one-passkey-per-Service-Identity custody is later judged worth the added engineering cost (MAIN-world override or `chrome.webAuthenticationProxy`, per the research doc §4), it becomes its own named roadmap phase, sized and reviewed on its own — not a quiet scope expansion of an existing phase.
