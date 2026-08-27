# Attestto Creds Extension — Source-Verified Technical Teardown

## Provenance

This teardown is based on a full clone of `https://github.com/Attestto-com/attestto-creds-extension`, cloned into a local scratch directory (not part of this repo) and read directly — every claim below marked **[source]** was confirmed by opening the cited file. Nothing here is a repeat of `docs/competitive-landscape.md`'s earlier second-hand summary.

- Commit read: `351097938bae86f3a3c6d7ef4799ac3b627eacc6` (Aug 23 2026)
- Stack **[source: `package.json`]**: WXT 0.20, Vue 3.5, Pinia 3, Vue Router 4, Tailwind 4, TypeScript 5.9, Vitest 4. Crypto/VC-relevant deps: `@noble/hashes` 1.8 (Argon2id), `jose` 6.1 (JWS/JWT), `@sd-jwt/decode`, `@sd-jwt/present`, `@sd-jwt/types` (all 0.19), `zod` 3.25. Two private/internal packages (`identity-bridge`, `@attestto/tls-audit`, both `^0.1.0`) are dependencies but their source is **not** in this repo and was **not** inspected — anything attributed to them below is inferred from how they're called, not verified from their own source.
- **No Shamir/threshold-crypto library is a dependency** — confirmed absent from `package.json`. The 2-of-3 scheme is hand-rolled (see below).
- No DID-resolution or DID-method library is used for `did:jwk` — also hand-rolled.

Where I could not verify something from source, it is explicitly flagged as inferred.

---

## 1. Vault structure & encryption at rest

**Dual-vault design — two separate `chrome.storage.local` entries** **[source: `src/utils/vault.ts`, `CLAUDE.md`]**:

| Layer | Storage key | Encrypted? | Contents |
|---|---|---|---|
| Public vault | `attestto_ext_public` | No | `did`, `credentials[]` (PII-neutralized — see below), `linkedSolanaAddress`, `keyShares[]`, `proofRequests[]`, `preparedPresentations[]`, `verificationMethod`, `holderDid`, `linkedIdentities[]`, `siteDids` (origin → `{did, createdAt, lastUsedAt}` only — **no private keys**) |
| Encrypted vault | `attestto_ext_vault` | AES-256-GCM | Everything in `VaultData` (`src/stores/wallet.ts`), which is the public shape **plus** `privateKeyJwk`, `ed25519PrivateKeyJwk`, and the full `siteDids: Record<origin, SiteDidEntry>` map **including each site's `privateKeyJwk`** |

**Encryption** **[source: `src/utils/crypto.ts`]**: `AES-GCM`, 256-bit key, 12-byte random IV generated per encrypt call via `crypto.getRandomValues`, IV prepended to ciphertext, whole thing base64-encoded. `encryptVault(data, keyBase64)` / `decryptVault<T>(base64, keyBase64)` — plaintext is `JSON.stringify` of the object, so the entire `VaultData` is one opaque encrypted blob (not field-level encryption).

**Key storage / derivation** **[source: `src/utils/webauthn.ts`]**: the AES key is **not** stored anywhere at rest as itself. It's derived on each unlock:
1. WebAuthn `create()`/`get()` with the **PRF extension** (`hmac-secret`) against a registered platform/roaming authenticator, `userVerification: 'required'`.
2. The PRF output (`prf.results.first`) is imported as HKDF key material and run through **HKDF-SHA256** with a fixed `info` string `"attestto-id-vault-key"` and a random 32-byte `salt` (generated once at setup, persisted in `chrome.storage.local` as `PRF_SALT`) to derive a 256-bit AES-GCM key.
3. That derived key is cached, base64-encoded, in **`chrome.storage.session`** (`attestto_ext_session_key`) — RAM-only, cleared when the browser closes or on explicit lock.

Notably: **there is no passphrase fallback for the live vault.** An earlier Argon2id-passphrase KDF path was **deliberately deleted** — the module header in `webauthn.ts` explains the team removed it because it made "passkey-protected" an unverifiable claim (a passphrase-derived key produces a signature indistinguishable from a passkey-derived one) and because the vault holds no bearer assets, so there's nothing worth a recovery mechanism weaker than "reset and re-mint." An authenticator without PRF support gets a hard failure (`PRF_UNSUPPORTED`), not a downgrade.

Argon2id (`src/utils/passphrase-kdf.ts`, using `@noble/hashes/argon2`, params `t=2, m=19456 KiB, p=1`, OWASP 2024 interactive-use recommendation) still exists, but only as the KDF for one of the two **export-file** backup methods (`services/vault-backup.ts`) — a separate, explicit "Settings → export backup" action, never part of unlock.

---

## 2. Pairwise identity derivation — the central finding

**This is the most important and most surprising result of this teardown, and it directly contradicts what our own `docs/competitive-landscape.md` assumed about Attestto.**

**[source: `src/utils/site-did.ts`]** — there is **no cryptographic derivation function from a root key + origin at all**. `generateSiteDid()` does exactly this:

```ts
export async function generateSiteDid(): Promise<SiteDidEntry> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  // ...export publicJwk/privateJwk, wrap in did:jwk...
}
```

It's a **fresh, independently-random P-256 keypair**, generated via the browser's CSPRNG — not derived from anything. `findOrCreateSiteDid(siteDids, origin)` then does find-or-create against a plain `Record<origin, SiteDidEntry>` map stored inside the encrypted `VaultData`: `normalizeOrigin(origin)` is used **purely as a storage/lookup key**, never as HKDF `info`, HMAC data, or any other KDF input.

So "pairwise per-origin identity" in Attestto means: *generate a random keypair the first time an origin is seen, remember it forever in the vault (keyed by origin), reuse it on every later visit.* It is **generate-and-store**, not **derive-and-forget**. Concretely:

- Unlinkability across origins holds (each origin's key is statistically independent — stronger than derivation from the same root, if anything, since there's no shared mathematical relationship an attacker could exploit even in a worst-case KDF break).
- But it has a real cost our docs should register: **the per-site keys are only as durable as the vault backup.** There is no "recompute `derive(root, origin)` on a fresh device" recovery path — if the encrypted vault (and its Shamir/passphrase backup) is lost, every per-site identity is gone and must be re-minted (new key per origin, breaking continuity with the site). The root signing key (`did`/`holderDid`) is **also** just a freshly-generated random P-256 keypair at `setup()`/`createDid()` **[source: `src/stores/wallet.ts`]** — there is no seed-phrase-style deterministic hierarchy (no BIP32/SLIP-10-style HD derivation) anywhere in this codebase. "Root identity" in Attestto is not a seed that regenerates children; it's just the first randomly-generated key, given no special mathematical role over the per-site ones.

**`did:jwk` construction** **[source: `src/utils/did-jwk.ts`]** is simple and self-resolving: `did:jwk:<base64url(JSON({kty,crv,x,y}))>` — the public key is embedded directly in the identifier, so any resolver reconstructs the DID Document with no network call. Verification method ID is `${did}#0` (fixed suffix, single key).

**Implication for us:** the "derive(root, origin) via HKDF/HMAC" scheme our `docs/identity-model.md` gestures at (and marks unresolved) is **not** what Attestto actually does, so we cannot lean on "Attestto already solved this" as license to defer the design. Attestto sidestepped the derivation problem entirely by not deriving. See the Implications section at the end for what this means for our own design.

---

## 3. Credential API bridge

**[source: `src/entrypoints/credential-api.content.ts`, `src/entrypoints/credential-handler.content.ts`]**

Two content scripts run on `https://*/*` (+ `localhost`/`127.0.0.1` for dev), injected at `document_start`:

- **`credential-handler.content.ts`** runs in the page's **MAIN world** (so it can touch `navigator.credentials` before the page's own scripts run). It:
  - Overrides `navigator.credentials.get` to intercept two shapes: (a) the W3C CHAPI convention `{ web: { VerifiablePresentation: {...} } }`, and (b) a proprietary Attestto shape `{ publicKey: { extensions: { attesttoVP: {...} } } }` (or `{ identity: { attesttoVP } }`). Anything else falls through to the real, original `navigator.credentials.get`.
  - Implements a **separate, non-Credential-Management-API discovery protocol** (`identity-bridge`, the private npm dependency): listens for a `credential-wallet:discover` `CustomEvent` and answers with a `credential-wallet:announce` event carrying wallet metadata (`did:web:attestto.com:wallets:attestto-creds`, name, icon, supported protocols). A second custom event, `credential-wallet:auth`, implements a DID-based login/challenge-signing flow independent of WebAuthn.
  - Since MAIN-world scripts have **no access to `chrome.*` APIs**, everything it needs from the extension is relayed via `window.postMessage` to the ISOLATED-world script.

- **`credential-api.content.ts`** runs in the **ISOLATED world** and is the only bridge that can call `chrome.runtime.sendMessage`. It listens for `window.postMessage` events of specific types (`ATTESTTO_VP_REQUEST`, `ATTESTTO_AUTH_REQUEST`, `ATTESTTO_CW_AUTH_REQUEST`, `ATTESTTO_SIGN_REQUEST`, `ATTESTTO_PAYMENT_REQUEST`, `ATTESTTO_CREDENTIAL_PUSH`, `ATTESTTO_DID_SYNC`, `ATTESTTO_SIGN_PDF_REQUEST`), forwards each to the background service worker as a typed `chrome.runtime` message, and relays the background's response back into the page via `window.postMessage(..., window.location.origin)` — scoped to the exact origin, not `'*'`.

The background (`src/entrypoints/background.ts`) receives `CREDENTIAL_API_REQUEST`, stores it as a pending row, and opens a dedicated approval popup window (`approval.html`, not the toolbar popup) — same UX pattern as MetaMask/Phantom dApp-connection prompts. On approval, `handleChapiApprove` (`src/background/handlers/chapi-approve.handler.ts`) builds a Verifiable Presentation and the response flows back: background → `chrome.tabs.sendMessage` to the originating tab → ISOLATED content script → `window.postMessage` → MAIN-world listener resolves the intercepted `navigator.credentials.get()` promise.

---

## 4. Consent / field-level approval flow

**State management** **[source: `src/background/consent/pending-store.ts`, `pending-flow.ts`, `approval-window.ts`]**: each distinct flow (credential offer, CHAPI/VP request, document signing, payment, DID auth, Attestto-PDF signing) has its own "pending flow" — a small state machine with `put`/`peek`/`take`/`approve`/`attachUnregister`. Rows are persisted in **`chrome.storage.session`** (not an in-memory `Map`), specifically because the MV3 service worker can be killed after ~30s idle and an approval flow is, by definition, waiting on a human — an in-memory `Map` lost its rows mid-approval in an earlier version (documented in the code as a real, shipped bug). `approve()` is written as an atomic claim-then-effect: the row is removed and the approval window's cleanup hook disarmed *before* the effect runs, specifically to prevent a race where a closing window and a genuine approval could both report an outcome for the same request (double-processing).

**UI**: a separate `approval.html` popup window per flow (sized per flow, e.g. 380×580 for signing/payment/CHAPI, 420×560 for credential offers), not the toolbar popup — the toolbar popup (`popup/App.vue`) is a separate, always-available surface for viewing/managing the vault, unlock/lock, and identity list.

**Field-by-field selective disclosure is real for SD-JWT, but explicitly refused for JSON-LD VCs** **[source: `src/background/handlers/chapi-approve.handler.ts`, lines ~40–91]**. The CHAPI/proprietary-protocol path can accept a `requestedFields` list from the page, but `assertNoSilentReduction()` **rejects any request that asks for a strict subset of a JSON-LD credential's claims**, with the reasoning spelled out in comments: reducing a JSON-LD VC to fewer claims drops the issuer's signature coverage, producing a "holder-attested" document a verifier can't distinguish from an issuer-attested one — so the wallet refuses rather than silently downgrade what the verifier is trusting. Only a request naming *every* subject key (i.e., no real reduction) is honored. Genuine per-claim selective disclosure exists only for the SD-JWT credential format (section 6 below).

**Consent principles, as currently stated in the repo's own operating rules** **[source: `CLAUDE.md`, "The consent rules" section, dated 2026-08-14]** — worth reading verbatim because it documents a real policy reversal:
1. A page is untrusted by default and may only present itself — no page-facing read path into the vault exists at all (not gated, structurally absent).
2. No DID presented, no conversation.
3. A trusted DID may *ask*, and the ask goes to the user — trust authorizes making a request, never receiving an automatic answer.
4. **"There is never an auto-accept. Literally never."** Approving an origin once is not standing consent for what it sends afterward.

This replaced an earlier "trust-on-first-use" design where, after a user approved one credential offer from an origin, *all later offers from that origin were silently auto-accepted*. The team's own note calls this out as the wrong shape entirely ("it read as the safe version of a bad idea rather than as the bad idea") and removed the silent-acceptance branch outright — `handleCredentialOffer` now has no branch that can skip the approval window. Origin trust (`src/utils/trusted-origins.ts`) still exists but now authorizes a narrower thing: the `DID_SYNC` channel from the platform's own origin, not disclosure of anything.

---

## 5. Shamir recovery

**[source: `src/services/shamir.ts`, `src/services/vault-backup.ts`]**

The 2-of-3 scheme is **hand-rolled**, not a library: a degree-1 polynomial `f(x) = secret + a1·x` over `GF(256)` (byte-wise, same field as AES), evaluated at `x = 1, 2, 3` to produce three shares; reconstruction is 2-point Lagrange interpolation at `x = 0`. GF(256) multiply/inverse are implemented from scratch (Russian-peasant multiplication with the AES irreducible polynomial `0x1b`; inverse via repeated squaring, `a^254 = a^-1`).

**What's actually split is not the signing key.** `exportShamirBackup(vault)`:
1. Generates a **fresh random AES-256 content-encryption key (CEK)** (`generateEncryptionKey()`), unrelated to any identity key.
2. Encrypts the **entire `VaultData`** (all credentials, all `linkedIdentities`, all `siteDids` including their private keys) under that CEK with the same `encryptVault`/AES-256-GCM used for the live vault.
3. Splits the **CEK** (not the vault contents, not the signing key) into 3 shares via `split2of3`.
4. Shares are serialized as `"<index>.<base64url(bytes)>"` strings the user is told to store in three separate places (a note in a password manager, printed, given to a trusted contact, etc.) — this is **manual, offline distribution**; there is no automated guardian-DID delivery or DIDComm push of shares in this codebase. (`services/didcomm.ts` exists but, from what I read, backs an unrelated inbound-message flow, not Shamir-share distribution — I did not find a call site wiring DIDComm to the backup/recovery feature, so `docs/competitive-landscape.md`'s claim that DIDComm is used "for messaging" in the recovery flow is **not source-verified** and appears to conflate two separate features.)

Restore (`importShamirBackup`) takes the file plus any 2 of the 3 shares, reconstructs the CEK via `combine2of3`, decrypts the vault, and the caller re-encrypts it under the *new* device's passkey-derived key (`stores/wallet.ts`'s `restoreFromBackup`).

**A genuinely useful "what to avoid" finding**: `background.ts` documents, in comments, a **prior, now-removed** design (`KEY_BACKUP`/`KEY_RESTORE` messages) that split the *raw private signing key* directly 2-of-3 with no encryption layer in between. The team's own retrospective (verbatim from the source):

> "Two shares reconstructed the signing key outright — no passphrase, no ciphertext in between. A guardian held a piece of a key." … "They recovered the key and NOTHING ELSE. Credentials hang off `LinkedIdentity`, so a user who completed this recovery got a signer back with nothing to present."

They replaced it with the current design specifically because splitting a wrapping CEK (rather than the identity key itself) both (a) means two colluding shareholders reconstruct only a symmetric key that's useless without the ciphertext file, not a bare signing key, and (b) recovers the whole vault (credentials, identities, site DIDs), not just a lone key with nothing to present.

There is also a separate, simpler **2-of-2 XOR split** (`splitKey`/`combineShares`, same file) described in its own comment as "Share A → Vault Extension (user's device), Share B → Attestto platform (PII Vault)" — a platform-assisted recovery model. I did **not** find a call site for these two functions anywhere in `background.ts` or the handlers I read; I could not verify this path is wired into any live UI flow — flagging it as present-in-code-but-unconfirmed-as-active.

---

## 6. Selective disclosure / SD-JWT

**Implemented, not just planned** **[source: `src/services/sdjwt.ts`]**, using the real `@sd-jwt/decode` and `@sd-jwt/present` npm packages (not hand-rolled) plus `jose` for the Key Binding JWT signature. `createSdJwtPresentation(compact, selectedClaimNames, sign, nonce, audience)`:
1. Builds a disclosure "frame" (`{claimName: true}` per selected claim).
2. Calls `@sd-jwt/present`'s `present()` to produce an SD-JWT presentation containing only the selected disclosures (each disclosure is an independently-hashed, salted claim per the SD-JWT spec — the issuer's original signature still verifies because it only ever committed to the claim *hashes*, not the plaintext values).
3. Appends a **Key Binding JWT** (`typ: 'kb+jwt'`, `alg: ES256`) carrying the verifier's `nonce` and `audience`, signed via an injected `JwsSigner` function (so the signing key itself never enters this module — see the "gated signing" note in section 8).

As covered in section 4, this per-claim selective disclosure capability applies **only to the SD-JWT credential format**. JSON-LD VCs in this codebase cannot be selectively disclosed — the wallet refuses rather than produce a weakened presentation.

---

## 7. Extension architecture

**Manifest** **[source: `wxt.config.ts`]**:
- `permissions`: `storage`, `activeTab`, `scripting`, `notifications`, `offscreen`, `alarms`, `webNavigation`. No `<all_urls>` permission, no `tabs`, no `cookies`.
- `host_permissions` are narrowly scoped to specific Costa Rican government TLD zones (`*://*.go.cr/*`, `.fi.cr`, `.sa.cr`, `.ac.cr`, `.ed.cr`, `.or.cr`) — used only for an in-page "gov TLS trust bar" feature, explicitly **not** `<all_urls>`.
- Content scripts (`matches: ['https://*/*', ...]`) run broadly on every HTTPS page regardless of `host_permissions` (MV3 content-script injection via `matches` doesn't require the broader host permission the way a background-fetch would) — this is the actual broad attack surface, not `host_permissions`.
- `web_accessible_resources` is an explicit allowlist (`assets/*`, `wallet-discovery.js`, `icon/*`, `data/*`) — notably **excludes** the offscreen document page. A comment flags this as a fixed vulnerability (internally tagged `SOC-13`): the offscreen page had previously been web-accessible, letting any page fingerprint or load it.
- CSP for extension pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` — no remote script execution.
- `options_ui` opens as a full browser tab (`open_in_tab: true`), not the small popup-modal Chrome offers by default — a deliberate choice, credited in a comment to matching LastPass's pattern.

**Message passing**: a single `chrome.runtime.onMessage` listener in `background.ts` — at time of reading, a ~1,300-line `switch` over ~30 message type strings, still mid-refactor into a newer `background/router/dispatch.ts` pattern (a small number of routes — `DID_SYNC`, `DIDCOMM_INBOUND` — have been extracted into a "composition root" that hands capability-scoped `ctx` bundles to pure handler functions; most routes are still handled inline in the giant switch). Every reply is wrapped so `sendResponse` is guaranteed to fire exactly once even on a thrown error (a fix for a previously-shipped bug where an unhandled promise rejection meant the page or approval window waited on a reply that would never come, indistinguishable from a user walking away).

**Origin normalization**: a single canonical function, `normalizeOrigin()` in `src/utils/origin.ts`, used everywhere an origin is a map key (per-site identities, trusted-origins, site-identity-prefs). It reduces to `protocol//host` via the WHATWG URL parser (lowercases, punycodes IDN, strips default ports `:443`/`:80`, but *keeps* non-default ports — load-bearing for local dev). A comment states the team found **five independent copies of this logic** scattered across the codebase before consolidating; the consolidated version returns a branded `CanonicalOrigin` type so a raw, un-normalized origin string is a compile error wherever a normalized one is expected.

---

## 8. What looks fragile, over-engineered, or like a mistake

These are drawn directly from the Attestto team's own in-code retrospectives (comments explaining *why* something changed), which is unusually rich, source-grounded "lessons learned" material:

1. **The giant single-file `chrome.runtime.onMessage` switch statement** (still present, ~1,300 lines) is visibly being dismantled in favor of a capability-scoped dispatch/composition-root pattern, mid-migration. Reading it, the giant-switch approach clearly became unmaintainable at their current feature count (~30 message types, 6+ independent approval flows). **Worth designing our capability-scoped router from day one** rather than retrofitting it once the switch gets unwieldy.

2. **Dual-vault (encrypted + unencrypted public mirror) invites silent drift bugs.** Their own `CLAUDE.md` has a standing warning and an "audit periodically" grep instruction because forgetting to call `syncPublicVault()` after `writeVault()` is a real, previously-shipped bug class (a UI that silently shows stale/empty state because it reads only the public mirror). If we adopt a similar "cheap-to-read public metadata + expensive-to-read encrypted secrets" split, either (a) make the mirror update structurally impossible to skip (single write function that always does both), or (b) prefer deriving the public view on read rather than maintaining a second persisted copy that can go stale.

3. **MV3 service-worker lifecycle bugs, twice.** (a) An idle auto-lock timer that reset on *any* incoming message rather than a genuine user gesture — because MV3 revives the worker for any message, a background tab silently kept the "session" alive forever. (b) In-memory `Map`s holding pending-approval state were lost whenever the ~30s-idle worker was killed mid-approval, so a user's genuine "Approve" click could land on a service worker that no longer remembered what it was approving. Both were fixed by moving state to `chrome.storage.session` and keying auto-lock off explicit user-gesture events, not "was a message received." **Any MV3 extension with pending-approval UX should design state as session-storage-backed from the start, never as service-worker-local variables.**

4. **WebAuthn PRF has a genuine, subtle footgun**: `create()` (registration) reports `prf.enabled: true` but never returns the actual PRF secret; only a subsequent `get()` (assertion) returns `results.first`. Code that reads `results.first` off the *registration* response and concludes "PRF unsupported" is wrong on hardware that supports it perfectly — this caused a real, permanently-unrecoverable dead end on Brave/macOS in an earlier version (the credential ID got persisted before failure was detected, then every retry was pinned via `allowCredentials` to the one credential that would never work, with no picker). Fixed by always following up with a real assertion when `results` is absent and `enabled !== false`.

5. **The original Shamir-of-the-raw-signing-key design was a real mistake**, by the team's own account (quoted in full in section 5): splitting the bare private key 2-of-3 with no ciphertext layer between guardians, and recovering only a key with no credentials attached to present with it. The fix — split a random wrapping key, encrypt the *whole vault* with it, never touch the identity key directly — is the pattern worth copying if we ever build guardian/social recovery.

6. **Trust-on-first-use silently expanding into standing consent was caught and reverted** after what the repo calls a security review. The prior design ("approve once, auto-accept everything from that origin forever after") is exactly the anti-pattern our own Policy Engine should watch for: an origin-trust flag is easy to accidentally let leak into "therefore don't ask again," and that's precisely the shape Attestto's own team flagged as wrong after shipping it.

7. **Signing-liveness ("prove a live human right before this specific signature") cannot be enforced from the background service worker at all** — `navigator.credentials` doesn't exist in a service worker context. Their current code has an explicitly-named no-op placeholder (`DEFERRED_PRESENCE_PASSTHROUGH`) standing in for that gate in the background, with real enforcement living only in the popup/approval-window (a document context that *can* call WebAuthn). They flag the residual gap themselves: a caller that could reach the background's `*_APPROVE` handler directly, bypassing the approval window, would get a signature with no human check. The fully-designed fix (a short-lived, payload-hash-bound cross-process proof) is written up but explicitly deferred, not shipped. **This is a load-bearing architectural constraint for any MV3 extension wanting "re-verify presence per signature": the enforcement point must be a document context, and a service-worker-side gate is structurally decorative unless a cross-process proof protocol closes the gap.**

8. **Asymmetric selective disclosure by credential format** (real for SD-JWT, refused for JSON-LD VCs) is not a bug, but it is a nuance worth internalizing: "selective disclosure" is not one universal capability layered on top of any credential — it depends on the credential's own cryptographic structure (SD-JWT's salted per-claim hashes support it; a single monolithic issuer signature over a JSON-LD document does not, without something like BBS+ signatures).

---

## Implications for our design

1. **Do not adopt "HKDF/HMAC-derive a per-origin identity from the root key" on the strength of "Attestto already validated this" — it didn't do this.** Attestto's actual approach (generate a fresh random keypair per origin, store it forever, keyed by origin) sidesteps the derivation-math problem entirely rather than solving it. That's a legitimate design in its own right, but it's a different one from what `docs/identity-model.md` gestures toward with `derive(root, "github.com")`. We should decide deliberately between:
   - **(a) Attestto's approach — generate-and-store.** Simpler, no KDF design surface, arguably *stronger* unlinkability (no shared mathematical structure between per-site keys even under a KDF weakness). Cost: no origin-key is recoverable except by restoring the whole vault backup; losing the backup means every site relationship is severed and must be re-established from scratch, and the vault (`Record<origin, keypair>`) grows linearly with sites visited, all of which must be backed up.
   - **(b) A real deterministic derivation — e.g. HKDF-SHA256(ikm = root secret, salt = a fixed per-installation salt, info = normalized origin string) → per-origin seed → per-origin P-256/Ed25519 keypair.** This keeps `docs/identity-model.md`'s stated principle ("one identity per origin, root never leaves the device") but adds a genuine recovery property Attestto's design lacks: as long as the root secret and the origin string are known, the exact same per-site identity can be recomputed on a fresh device with no per-site backup at all — only the root needs backing up, not an ever-growing map. This is closer to what our own product-vision principles (local-first, root-holds-everything, minimal persisted state) would want, and is the recommendation: **use HKDF-SHA256 with the root key as IKM, a fixed application-level salt, and the normalized origin (exact form: `normalizeOrigin`-style `protocol//host`, matching Attestto's own hard-won lesson in `src/utils/origin.ts` about needing exactly one canonicalization function everywhere origin is a key) as the `info` parameter, producing per-origin key material that's then used to seed an ECDSA/Ed25519 keypair.** This gives us both properties Attestto's own approach doesn't have (recoverability from root alone) while keeping the property it does have (statistically independent-looking output per origin, since HKDF's output is indistinguishable from random per origin as long as the root IKM stays secret).

2. **Copy the canonical-origin-normalization pattern immediately, not after finding five copies of it.** One function, one branded type, used everywhere an origin is a storage key or KDF input. This is cheap now and expensive to retrofit (as Attestto's own history shows).

3. **Copy the dual-encryption-key architecture (device-unlock key ≠ backup/recovery key), but consider deriving rather than mirroring the public metadata.** Attestto's split between "vault encryption key, tied to this device's passkey PRF" and "a separate, freshly-generated key used only for portable backups" is sound and worth keeping. But their public/encrypted dual-*vault* (two full copies of overlapping data, one plaintext) is the part that caused real shipped bugs (stale UI from forgotten mirror syncs). If our own data model (see `docs/data-model.md`) needs an "always-readable-without-unlock" view (e.g., which sites have identities, for a popup UI), prefer computing it from a single source of truth with one write path, or accept the mirror-drift risk explicitly and build the "assert both were written together" check into the type system / a single write function, not a lint/audit habit.

4. **If we ever build any kind of secret-sharing recovery, never split the actual root key.** Split a random wrapping key that encrypts a full backup blob, exactly as Attestto's *current* (not original) design does. This is directly transferable and low-risk to adopt.

5. **Selective disclosure needs a credential-format decision, not a blanket feature flag.** If/when Identity Firewall represents disclosable "fields" as anything resembling a monolithically-signed credential, we inherit Attestto's same constraint: true per-field selective disclosure requires either an SD-JWT-style salted-hash-per-claim structure or something like BBS+ — it cannot be bolted onto a single-signature credential after the fact without either dropping the issuer's proof or lying about what was disclosed. Since our core differentiator (per `docs/product-vision.md`/`competitive-landscape.md`) is exactly this kind of per-field consent, this should be decided early rather than discovered the way Attestto discovered it (mid-build, requiring an explicit refusal path to avoid shipping a dishonest disclosure).

6. **Design pending-approval state as durable (survives our background context's restart) from the start**, and make signing-liveness enforcement live only in a context that can actually call WebAuthn/biometric APIs — never assume a service-worker-equivalent background context can gate a signature by itself. Both of these cost Attestto real, shipped bugs; we can have them right on day one for the price of reading their postmortems.

7. **Treat "trust an origin" and "consent to disclose X to that origin" as two permanently separate concepts**, never letting the former silently expand into the latter. This is literally the mistake our own Policy Engine exists to avoid, and it's also the exact mistake Attestto's own security review caught in their shipped code.
