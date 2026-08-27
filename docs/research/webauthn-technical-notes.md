# WebAuthn Technical Notes: Can a Browser Extension Orchestrate Passkeys?

This document is a source-grounded technical brief answering a specific pre-Phase-1 question: exactly how would Identity Firewall's browser extension create, store, and use passkeys on behalf of a per-site Service Identity, and what are the real constraints? It supports [architecture.md](../architecture.md), [identity-model.md](../identity-model.md), [browser-architecture.md](../browser-architecture.md), [security-model.md](../security-model.md), and [ADR-003](../adr/ADR-003-web-crypto-not-custom.md).

**Bottom line up front:** a browser extension *can* be a real, spec-compliant WebAuthn client-and-authenticator (this is exactly what Bitwarden, 1Password, Dashlane, and NordPass already ship). But it can only do this **for a ceremony the site's own page JavaScript initiates** — the extension cannot spontaneously register a passkey on a page that never calls `navigator.credentials.create()`. This confirms, rather than overturns, the split already implied in `browser-architecture.md`: legacy mode (plain HTML forms, no WebAuthn) gets password+alias generation; passkey orchestration only activates once a site's own code calls the WebAuthn API. Where our original brainstorm may have been optimistic is the assumption that the extension merely "helps the OS authenticator along" — the realistic path, if we want genuine control over key material and a strict one-passkey-per-Service-Identity model, is closer to **implementing our own software WebAuthn authenticator inside the extension** (Bitwarden/1Password's model), which is a materially bigger engineering scope than originally implied, not a smaller one.

---

## 1. Registration ceremony (`navigator.credentials.create()`)

Source: [MDN — CredentialsContainer.create()](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create), [MDN — Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API), [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/#rp-id).

The relying party (the site's server, via its front-end JS) builds a `PublicKeyCredentialCreationOptions` object:

```js
const options = {
  challenge,                       // required, server-generated random bytes (anti-replay)
  rp: { id: "example.com", name: "Example Corp" },   // required — rp.id is the origin-binding anchor
  user: { id, name: "user@example.com", displayName: "Example User" }, // required — server's opaque user handle
  pubKeyCredParams: [{ type: "public-key", alg: -7 }], // required — requested signature algorithms (-7 = ES256)
  authenticatorSelection: {         // optional
    authenticatorAttachment: "platform" | "cross-platform",
    residentKey: "required" | "preferred" | "discouraged", // discoverable credential request
    userVerification: "required" | "preferred" | "discouraged",
  },
  attestation: "none" | "indirect" | "direct" | "enterprise", // optional
  excludeCredentials: [ /* existing credential IDs, to prevent re-registering the same authenticator */ ],
  extensions: { /* e.g. credProps, prf, largeBlob */ },
};
navigator.credentials.create({ publicKey: options });
```

The browser/authenticator returns a `PublicKeyCredential`:

- `id` / `rawId` — the new credential ID (base64url / raw bytes).
- `response.clientDataJSON` — JSON containing `type`, `challenge`, **`origin`** (the actual calling page origin — this is the field that enforces origin binding, see §3), and `crossOrigin`.
- `response.attestationObject` — CBOR blob containing `authData` (rp ID hash, flags, sign count, the new public key in COSE format) and an attestation statement.
- `response.getPublicKey()` / `getPublicKeyAlgorithm()` — convenience accessors for the new public key.
- `response.getTransports()` — e.g. `["internal", "hybrid"]`.
- `authenticatorAttachment` — `"platform"` or `"cross-platform"`.

**Fields our extension would need to touch to orchestrate a passkey per Service Identity**, depending on which of the two integration paths in §3–4 we take:

- `user.id` / `user.name` / `user.displayName` — if we're generating a software credential ourselves, we choose what identifier gets bound into the credential; this is exactly where per-Service-Identity separation happens (each Service Identity gets its own `user.id`, never the Root Identity's).
- `rp.id` — we never set this ourselves in the "let the platform authenticator handle it" path; the site sets it and it must equal (or be a registrable-domain-suffix of) the calling origin. In the "extension-as-authenticator" path, we still don't get to override it arbitrarily for an unmodified third party — see §3.
- `residentKey` — we want to bias every registration toward discoverable/resident credentials (§5) since that's what makes "no site-side username needed" possible.
- `excludeCredentials` — relevant if we're tracking "does this Service Identity already have a passkey for this rp.id."
- We do **not** get to touch `challenge` (must stay server-issued, anti-replay) or invent our own attestation.

## 2. Authentication ceremony (`navigator.credentials.get()`)

Source: [MDN — CredentialsContainer.get()](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get).

```js
const options = {
  challenge,                 // required, server-generated
  rpId: "example.com",       // must match the origin the RP is bound to
  allowCredentials: [ { type: "public-key", id } ],  // optional — omitted/empty for discoverable-credential flows
  userVerification: "required" | "preferred" | "discouraged",
};
navigator.credentials.get({
  publicKey: options,
  mediation: "conditional" | "optional" | "required" | "silent",
});
```

`mediation: "conditional"` is the passkey-autofill mode: the browser lists discoverable credentials as non-modal autofill suggestions in a username/password-shaped `<input>` field (the field needs `autocomplete="username webauthn"`); the user picks one and completes user verification. This is the flow that makes "no site-remembered username" work end to end.

Return value: `PublicKeyCredential` with `response.authenticatorData`, `response.clientDataJSON` (again carrying the real `origin`), `response.signature` (proof of possession of the private key over the challenge + authenticatorData), and `response.userHandle` (echoes back `user.id` from registration — this is how the RP recovers *which* discoverable credential/account was used without a prior username step).

Nothing here is different in kind from registration re: what an extension can influence — same two paths as §3–4 apply.

## 3. Origin binding — the load-bearing constraint

Source: [W3C WebAuthn Level 3, RP ID](https://www.w3.org/TR/webauthn-3/#rp-id); [MDN Web Authentication API overview](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API).

A credential is cryptographically scoped to an RP ID, and the browser enforces at the platform level that `rp.id` (registration) / `rpId` (authentication) must equal the calling page's origin or a registrable-domain suffix of it. Separately, every ceremony's `clientDataJSON.origin` field is filled in by **whatever code actually executes the `navigator.credentials.*` call**, not by the RP ID string — this is the field an RP server checks against its own expected origin, and it's what actually prevents a phishing page from replaying a credential. This distinction — "what rp.id says" vs. "what origin the call actually ran from" — is the crux of the whole feasibility question:

- If our extension's own background/popup script calls `navigator.credentials.create()` directly, `clientDataJSON.origin` will be the **extension's own origin** (`chrome-extension://<id>` or `moz-extension://<hash>`), not the site's. A conforming RP server validates `origin` against its own allow-list and will reject this unless it explicitly special-cased our extension ID — i.e., this requires site cooperation, which breaks the "zero cooperation" legacy-mode goal (see §8 for the newer WebExtensions API that formalizes exactly this path, and why it doesn't solve the zero-cooperation case).
- If our code executes **inside the page's own JavaScript realm** (same `window`, same `document.location.origin`), then a call to `navigator.credentials.create()` from that context is, honestly and correctly, from the site's real origin — no spoofing involved, because it *is* that origin's browsing context. This is the mechanism real password-manager extensions use (§4).

**Can our extension "act as a virtual authenticator" for an arbitrary site with zero cooperation?** No — in both viable paths (§4), the extension can only produce a WebAuthn response for a ceremony that the **page's own script initiated** by calling `navigator.credentials.create()`/`get()`. It cannot inject a brand-new WebAuthn registration into a page whose JS never calls the API at all (a plain `<form>` with email/password inputs and no client-side WebAuthn code has literally nothing for us to intercept). This directly bounds what "legacy mode" can promise — see §8.

## 4. Platform authenticator vs. roaming authenticator vs. browser extension as authenticator

Sources: [chrome.webAuthenticationProxy](https://developer.chrome.com/docs/extensions/reference/api/webAuthenticationProxy), [Bitwarden's own architecture docs](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/), [W3C WebAuthn working-group mailing list, Oct 2024](https://lists.w3.org/Archives/Public/public-webauthn/2024Oct/0035.html), [MDN — WebAuthn API in web extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api).

There are, concretely, three ways a browser lets *something other than hardware* answer a WebAuthn call, and only two are usable for our "zero-cooperation legacy site" goal:

**(a) Platform authenticator (Windows Hello / Touch ID / Android StrongBox) or roaming authenticator (USB/BLE security key).** The browser itself talks CTAP to the OS or the hardware token; the private key is generated and held inside that OS keystore/secure element/hardware. The extension has no code path into this at all beyond what §7 describes (it can watch the page, it cannot touch the ceremony's internals).

**(b) The extension replaces `navigator.credentials` inside the page's own execution context and implements the authenticator itself, in software.** This is exactly what Bitwarden and 1Password ship today. Mechanically: the extension registers a content script that runs in the page's **MAIN world** (Chrome 111+ supports `world: "MAIN"` natively; historically this was done by injecting a `<script>` tag into the page) and reassigns `window.navigator.credentials.create`/`get` to its own functions, keeping references to the original native functions for fallback. Because this code runs *as* the page (same `window`, same real origin), it can honestly construct a `clientDataJSON.origin` equal to the site's real origin — nothing is spoofed. The extension then does the actual WebAuthn-shaped cryptography itself: generates an ECDSA/EdDSA key pair via a Web Crypto call, stores it in its own encrypted vault (not in OS/hardware), builds a CBOR `attestationObject`/`authenticatorData` by hand, and signs assertions — i.e., **the extension is a fully software-implemented, spec-conforming WebAuthn authenticator**, not a proxy to one. The Bitwarden docs explicitly note this only works because it *replaces* the native implementation wholesale (there's no browser API to run "alongside" it) — which is also exactly why Bitwarden and 1Password conflict with each other when both are installed: whichever extension's content script wins the injection race owns `navigator.credentials` for that page, and 1Password overriding it first has been reported to silently break Bitwarden's passkey autofill ([1Password Community thread](https://www.1password.community/1password-at-home-31/1password-extension-breaks-bitwarden-passkey-support-24740), [Bitwarden clients issue #20973](https://github.com/bitwarden/clients/issues/20973)).

**(c) `chrome.webAuthenticationProxy`** (Chrome 115+, MV3, `webAuthenticationProxy` permission) is Chrome's own answer to the reliability problem in (b). An extension calls `attach()` to become *the* active WebAuthn proxy (only one extension can be attached at a time — attaching fails if another extension already holds it, which is the standards-track fix for the 1Password/Bitwarden race). Once attached, real `navigator.credentials.create()`/`get()` calls **that the page itself makes** are routed to the extension's background service worker via `onCreateRequest`/`onGetRequest` events, carrying the real, W3C-shaped `PublicKeyCredentialCreationOptions`/`RequestOptions` (this API was actually designed for remote-desktop client software, but is general enough for any extension-based authenticator). The extension must call `completeCreateRequest()`/`completeGetRequest()` with a real response; browser bookkeeping (origin checks, etc.) still happens before the event fires, so the extension is receiving an already-origin-validated request, not one it has to fake the origin for.

**Does the WebExtensions "webauthn API" (Firefox 139+ / Chrome 122+, letting an extension call `navigator.credentials.create()` from its own background/popup context with an arbitrary `rp.id` inside its `host_permissions`) solve the "act as authenticator for any site" problem?** No — this is a materially different, narrower mechanism, and it's important not to conflate it with (b)/(c). Per MDN's own docs, the resulting `clientDataJSON.origin` is still the **extension's own origin** (`chrome-extension://…` / `moz-extension://…`), because that's genuinely the context the call executed in. A real site's unmodified backend validates `origin` against its own expected value and will reject an extension-origin assertion unless the RP explicitly allow-lists that extension ID — i.e., **this path requires site cooperation**, exactly the thing our zero-cooperation legacy mode is trying to avoid. It's suited to first-party or enterprise scenarios (a company's own SSO extension, where the RP is written to expect it), not to "any GitHub-style site with a passkey button."

**Honest answer for our docs:** there is no standards-based way for our extension to spontaneously mint a passkey nobody asked for, and no way to "hold" a real platform-authenticator private key (Windows Hello's key material never leaves the TPM/Secure Enclave, full stop — no API exposes it to any application, extension or otherwise). The realistic, standards-grounded path to "our extension orchestrates a passkey per Service Identity" is **route (b) or (c) above: our extension becomes its own software WebAuthn authenticator**, generating and holding key material itself (via Web Crypto, consistent with ADR-003 — this is not "inventing a ceremony," it's implementing the existing wire format faithfully), for ceremonies the site's own JS initiates. This is real and shipping (Bitwarden, 1Password, Dashlane, NordPass all do it), but it is a **bigger engineering scope than "call `navigator.credentials.create()` and let the OS handle it"** — we would own CBOR encoding, COSE key formats, authenticatorData flag bits, sign counters, and (for MV3 reliability) either the MAIN-world-override approach with its race-condition failure mode, or `chrome.webAuthenticationProxy` (Chrome-only; no Firefox/Safari equivalent surfaced in this research). The alternative, lighter-weight design is to **not** build our own authenticator at all: let the OS/hardware platform authenticator do the real cryptography when a site's JS calls `navigator.credentials.*` normally (no interception), and scope the extension's job down to (i) noticing the site supports WebAuthn and nudging the user toward it, (ii) recording, per Service Identity, *metadata only* — which `rp.id` and credential ID map to which Service Identity — never a private key, and (iii) autofill/UX orchestration around that metadata. Both are legitimate; §"Implications for our design" below recommends which to pick and when.

## 5. Resident (discoverable) vs. non-resident credentials

Source: [MDN — Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API).

- **Discoverable/resident credential**: the authenticator itself stores the private key, the associated `user.id`/`user.name`, and the `rp.id`. The RP server doesn't need to know a username in advance — the browser can enumerate "which credentials do I hold for this `rp.id`" and offer them via autofill (`mediation: "conditional"`). **Passkeys are defined to always be discoverable credentials.**
- **Non-resident credential**: the RP server stores an encrypted blob (the credential ID itself is ciphertext, decryptable only by the authenticator's master key) and hands it back at auth time via `allowCredentials`; the authenticator never needs to persist anything per-credential beyond its own master key. This is the older, pre-passkey WebAuthn (FIDO U2F-descended) model — it requires the site to already know/prompt for a username.

For our "one passkey per Service Identity, no site-remembered username" goal, we specifically want **`residentKey: "required"`** (or at least `"preferred"`) on every registration we orchestrate — this is what makes the RP-server-side username-first step unnecessary and is the entire point of the passkey UX model.

## 6. Multiple credentials per origin

Yes — nothing in the spec limits an authenticator (platform, roaming, or software/extension-based) to one discoverable credential per `rp.id`. This is exactly the mechanism behind existing "choose an account" passkey pickers (e.g. a user with two Google accounts, each with its own resident credential for `accounts.google.com`, sees both in the autofill/account-chooser UI) and behind "register another security key" flows most sites already support (multiple credentials tied to one account). Each credential is independently keyed by its own credential ID and carries its own `user.id`/`user.handle`. This is directly useful for us: if we ever want a user to maintain more than one Service Identity *within a single origin* (e.g., two separate personas on the same site), that maps cleanly onto "two separate discoverable credentials, same `rp.id`, different `user.id`s" — no spec-level obstacle, only UI/UX design work on our side (and on picking which of the two the account chooser should surface, since from the RP's perspective these look like two different accounts, which is in fact what we want).

## 7. What a content script can and cannot observe/control (MV3 specifics)

This follows directly from §4:

- **Isolated-world content scripts (the MV3 default)** share the page's DOM but run in a separate JS realm from the page's own scripts. Monkey-patching `navigator.credentials.create` from an isolated-world content script does **not** intercept calls the page's own `<script>` makes — they're different `navigator`/`window` object graphs at the JS-engine level, even though they render the same DOM. This is precisely why password-manager extensions don't use plain isolated-world content scripts for this.
- **MAIN-world content scripts** (`world: "MAIN"` in MV3's `content_scripts` / `chrome.scripting.executeScript`, Chrome 111+; historically simulated via `<script>` tag injection) execute as if they were the page's own code. Only from here can our extension actually override `navigator.credentials.create`/`get` such that the page's own calls are intercepted. This is a real, load-bearing MV3 capability, but it comes with the race-condition failure mode noted in §4(b): whichever extension's MAIN-world script wins the override "last" owns the API for that page load, so co-installed passkey-managing extensions can and do break each other.
- **`chrome.webAuthenticationProxy`** (§4c) sidesteps the race by making the browser itself the arbiter (`attach()`/`detach()`, one attached extension at a time) rather than relying on script-injection ordering — this is the more robust of the two interception mechanisms, but it is Chrome-only.
- **Without either mechanism**, a content script has **no visibility at all** into a WebAuthn ceremony happening on its page — it cannot read `PublicKeyCredentialCreationOptions` before the page's call, cannot observe the resulting credential ID, and cannot inject/modify options in flight. Passive observation (e.g., "did this page just call WebAuthn") is not available for free; it requires being the interception layer.
- **Practical takeaway**: any design where our extension "just watches" a page's WebAuthn ceremony and records what happened *without* being the thing that answers `navigator.credentials.create()/get()` is not achievable in MV3. To track "which Service Identity has a passkey on this `rp.id`," we either (a) are the authenticator that created it (so we already know), or (b) have no way to find out except asking the user / inferring from UI (e.g., detecting a "sign in with a passkey" button existing on the page, which is a DOM heuristic, not a WebAuthn-level fact).

## 8. Practical implication for "legacy web compatibility" mode

Confirms the current `browser-architecture.md` design, with one clarification. For a site with **no client-side WebAuthn code at all** (a plain email+password `<form>`), our extension has categorically nothing to intercept — §3 and §7 both establish that every viable extension-authenticator mechanism only fires in response to the page's own `navigator.credentials.create()`/`get()` call. There is no "inject a passkey into a form" move available at any layer (page script, content script, or platform proxy) when the form itself never touches the WebAuthn API.

So the near-term legacy flow described in `browser-architecture.md` — form detection → field classification → Identity Firewall → Policy Engine → consent → **generate a strong unique password + alias** → autofill — is the correct and, in fact, the *only* available mechanism for that class of site. Passkey orchestration is additive and conditional: it becomes available exactly when a site's own JS starts calling `navigator.credentials.*` (which, per this research, is a large and growing fraction of the web already, since most WebAuthn adoption today happens through server-side SDKs like SimpleWebAuthn/Duo/Okta that add a client-side `create()`/`get()` call plus a "sign in with a passkey" button, not through some separate discovery signal). When that's present, whichever integration route we choose from §4 kicks in.

One nuance worth calling out explicitly in `browser-architecture.md`: "site supports WebAuthn" is not binary at the level our extension can detect for free. We can't ask the browser "does this page use WebAuthn" — we can only notice it by being the interception layer (§7) or by DOM/heuristic detection of an actual `navigator.credentials` call attempt. Practically this means: even in "legacy mode," our content script should attempt the MAIN-world override (or feature-detect an opportunity to install `chrome.webAuthenticationProxy`) on every page proactively, and fall back cleanly to password+alias generation when no WebAuthn call ever arrives — rather than trying to pre-classify sites as "legacy" vs. "WebAuthn-capable" up front.

---

## Implications for our design

`browser-architecture.md` and `identity-model.md` both currently describe passkeys as something the extension straightforwardly "orchestrates," alongside aliases and passwords, as if it were a peer capability of roughly the same shape and difficulty. This research suggests two concrete revisions worth making before Phase 1 locks in a data model or component boundary:

1. **`browser-architecture.md` — add an explicit "WebAuthn integration mode" decision.** The document should state, up front, which of the two real options we're building toward:
   - *Option A (lighter, recommended for MVP):* the extension never intercepts or holds passkey key material at all. It relies entirely on the OS/platform authenticator (or the user's existing password manager) to do real WebAuthn ceremonies when a site's JS calls `navigator.credentials.*` normally; our extension's WebAuthn-related job shrinks to *metadata only* — noticing (heuristically, per §8) that a site offers passkey signup/login, nudging the user, and recording, per Service Identity, which `rp.id`/credential ID pairing exists. This keeps us honestly inside "we don't hold keys, biometrics/passkeys unlock via the OS," consistent with the existing "biometrics unlock, never are the identity" framing in `identity-model.md`, and avoids the CBOR/COSE/attestation implementation burden entirely.
   - *Option B (heavier, Bitwarden/1Password-style):* the extension becomes its own software WebAuthn authenticator (MAIN-world override or `chrome.webAuthenticationProxy`), generating and storing key material itself via Web Crypto (per ADR-003) in the vault. This gives us the strict "one passkey per Service Identity" enforcement the identity model wants, but is a real chunk of engineering (wire-format encoding, sign-counter bookkeeping, the MAIN-world race condition against other password managers, Chrome-only reliable path) that should be sized and scheduled as its own roadmap phase, not folded silently into "credential manager, does passwords and passkeys."
   
   Recommendation: ship Option A for MVP/Phase 1 (it requires zero new interception machinery and is honest about what we do and don't control), and treat Option B as a clearly-named later phase in `docs/roadmap.md` if we decide strict key custody per Service Identity is worth the cost.

2. **`identity-model.md` — the "Service Identity holds: … passkeys" line needs a footnote.** As written, it reads as though the Service Identity record *contains* a passkey the way it contains an alias or a password. Under Option A, what it actually contains is a *reference* (rp.id + credential ID + maybe public key, for our own bookkeeping) to a credential whose private key lives in the OS/hardware authenticator or a separate password manager, not in our vault. Under Option B, it would genuinely hold key material we generated, which is a different security posture (our vault becomes the thing an attacker wants, rather than the OS keystore) and should be reflected in `security-model.md`'s vault-contents description and threat model if Option B is ever adopted.

3. **No change needed to the "zero cooperation" legacy-mode claim itself** — §8 confirms the current design's behavior (password+alias generation when no WebAuthn is present) is both correct and the only option; it just needs the one-line clarification above about how "does this site support WebAuthn" gets detected in practice.

---

## Sources consulted

- [MDN — CredentialsContainer: create() method](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create)
- [MDN — CredentialsContainer: get() method](https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get)
- [MDN — Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [MDN — Use the WebAuthn API in web extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api)
- [W3C WebAuthn Level 3 — RP ID](https://www.w3.org/TR/webauthn-3/#rp-id)
- [Chrome for Developers — chrome.webAuthenticationProxy](https://developer.chrome.com/docs/extensions/reference/api/webAuthenticationProxy)
- [Bitwarden Contributing Docs — Passkey provider: browser extension](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/)
- [W3C public-webauthn mailing list, Oct 2024 — "platform authenticator" terminology / browser-extension-as-passkey-provider discussion](https://lists.w3.org/Archives/Public/public-webauthn/2024Oct/0035.html)
- [1Password Community — "1Password extension breaks Bitwarden passkey support"](https://www.1password.community/1password-at-home-31/1password-extension-breaks-bitwarden-passkey-support-24740)
- [GitHub — bitwarden/clients issue #20973](https://github.com/bitwarden/clients/issues/20973)
