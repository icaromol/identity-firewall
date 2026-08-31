# Phase 5 — Vault Completion

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 5, weeks 15–16. **Objectives:** a popup screen for the user's own real `PersonalData`; a local password generator; recognizing login forms and telling a signup from a login; capturing and offering to save a typed login; a plain saved-credential list with fill; deterministic per-site fake values. **Deliverable:** the "Real" response type, and the credentials side of the vault, both actually reachable by a real user for the first time.

This phase does not touch external email-alias providers (that's Phase 9) or biometrics (that's Phase 7) — see "Explicitly out of scope" in `docs/roadmap.md`'s Phase 5 section.

## What already exists, confirmed by reading the actual code

- `GET_PERSONAL_DATA`/`SET_PERSONAL_DATA` (`shared/messages.ts`, `background/vault/personalData/`) have been fully implemented since Phase 2 M6 — storage, handler, router registration, all working. **`entrypoints/popup/App.vue` has never grown a screen that calls either one.** Confirmed by grep: zero matches for `PersonalData`/`PERSONAL_DATA` in the popup component.
- `GET_CREDENTIAL`/`SAVE_CREDENTIAL`/`DELETE_CREDENTIAL` (same file, `background/vault/credentials/`) are in the same state — complete backend, zero popup UI.
- `background/firewall/responseGenerator.ts`'s `'real'` branch is `personalData[fieldType] ?? null`, and `null` means "fill/send nothing" to every caller. **Choosing "Real" for any field today silently does nothing** if `PersonalData` was never populated — which it never has been, since there's no UI to populate it. This is the single gap M1 closes.
- `background/firewall/classifier.ts` only ever maps a field onto one of `PersonalDataSchema`'s six field types or `null`. A `type="password"` field has no synonym in `FIELD_SYNONYMS` and always classifies to `null` — the classifier's own header comment says a field it can't classify is "left entirely alone by the rest of the Firewall." Password fields are invisible to the Identity Firewall/Policy Engine today, by design, but that also means nothing captures or offers to save them.
- `content/formDetection.ts` reports forms exactly once, at `document_idle` — it has no submit listener at all. Capturing a typed login (M4) needs a genuinely new content-script capability, not an extension of an existing one.
- `background/firewall/syntheticGenerator.ts` calls `crypto.randomUUID()` fresh on every invocation — the same field on the same site returns a different fake value every time it's filled. This directly contradicts `product-vision.md`'s own claim (line 259) that a fabricated value is "useful for detecting who leaked your data," which requires the value to be stable per site.

## Key design decisions

1. **Signup vs. login recognition, priority-ordered** (resolves an open question raised directly by the user): (1) the standardized `autocomplete="current-password"` (login) vs. `autocomplete="new-password"` (signup/change-password) attribute — the same signal browsers' own built-in password managers key off of, and consistent with `classifier.ts`'s existing convention of trusting a structural HTML signal before falling back to weaker heuristics; (2) presence of a second/"confirm password" field, when a site doesn't declare `autocomplete` at all; (3) field count / URL pattern only as a last resort. Kept in a new module, not folded into `classifier.ts`, since a password is never a `PersonalData` field type and must never flow through `responseAvailability.ts`'s real/synthetic/nonsense/deny matrix.
2. **Save-prompt uses only the simplest existing mechanism — confirmed with the user twice.** A captured-but-unconfirmed login becomes another kind of "pending" item surfaced through the same toolbar-badge + popup pattern Phase 4 already built for policy decisions. No new browser permission, no `chrome.notifications`. A native OS notification was explicitly considered and cut — recorded in `docs/roadmap.md`'s Phase 8 section as a deferred idea to revisit later, not built here.
3. **No masked/obscured value preview in this phase — confirmed with the user.** The saved-credential list (M5) shows what's saved plainly. A masked preview with 3 configurable reveal levels needs an in-page surface to render against a specific field, which doesn't exist until Phase 8.
4. **Password generation uses only Web Crypto's `crypto.getRandomValues`, never `Math.random`** — per `security-model.md`'s "never invent cryptography" stance, applied here even though a generated password isn't itself a cryptographic key, on the principle that this project's one and only source of randomness is Web Crypto, full stop.
5. **Deterministic Synthetic values reuse ADR-010's HKDF-per-origin derivation pattern**, not a new mechanism — the same root secret + origin used to derive a Service Identity's keypair is used here to seed a stable fake name/email. Documented as a new ADR (ADR-016) rather than folded silently into ADR-010, since it's a materially different purpose (fabricated personal data, not a keypair) even though the derivation shape is the same. `generateNonsenseValue` is untouched — "deliberately absurd" has never carried a leak-detection claim, only Synthetic does.
6. **A captured login is staged, never written to the vault until confirmed.** Mirrors Phase 3's own pending-request pattern: session state (not the encrypted vault) holds the captured username/password until the user explicitly confirms via the popup, at which point the existing `SAVE_CREDENTIAL` message does the real, encrypted write. An unconfirmed capture that's never opened just ages out with the rest of session state (cleared on browser restart, same as everything else in `chrome.storage.session`).

## Milestone breakdown

### M1 — Personal Data UI

- New `stores/personalData.store.ts`, same fetch-on-mount shape as `stores/privacyLedger.store.ts`: `GET_PERSONAL_DATA` on load, `SET_PERSONAL_DATA` on save (already patch-style — omitting a field leaves it untouched).
- New popup section in `entrypoints/popup/App.vue`, sibling to the existing vault/pending-request/privacy-ledger sections: a plain form for the six `PersonalData` fields, pre-filled from the store, a Save button.
- **Acceptance**: manual — enter personal data via this new screen, then on a real site choose "Real" for a field; the value that was actually typed here appears in the live page. This is the acceptance criterion for the whole phase's opening motivation, not just this milestone.

#### M1 — Implementation (as built)

Built as planned: `stores/personalData.store.ts` (no active-tab dependency at all, since `PersonalData` is one vault-wide blob — genuinely simpler than `firewall.store.ts`/`privacyLedger.store.ts`), a new "Personal data" section in `App.vue` between "What this site knows about you" and "Vault", 7 unit tests, and a real-browser Playwright test (`tests/e2e/personalData.test.ts`) — the first e2e test in this project able to exercise a popup data flow fully end-to-end rather than only its graceful-degradation path, since this store doesn't depend on `activeTab`/`browser.tabs.query()` the way `firewallApproval.test.ts` documented `firewall`/`privacyLedger` both do.

**Found while writing that e2e test, not before**: `personalData.fetchPersonalData()` runs once on mount, before the vault is necessarily set up. Nothing re-triggers it when `vault.setupWithPassphrase()`/`unlockWithPassphrase()` succeeds later in the same popup session — so entering personal data immediately after first-time setup, without closing and reopening the popup, would show the stale `VAULT_LOCKED` error instead of the form. This isn't a regression specific to this store: `vault.store.ts` doesn't refetch `firewall`/`privacyLedger` after unlock either — every store fetches independently, once, on its own mount, and this is the first time that shared convention was actually exercised end-to-end rather than just reasoned about. Documented here as a known, accepted gap consistent with the rest of the codebase, not fixed — the real-world workaround (reopen the popup) is exactly what the e2e test itself does, and is also what a real first-time-setup flow already looks like in practice (see `vaultLifecycle.test.ts`'s own identical reload-to-see-fresh-state step after an unlock/restart).

### M2 — Password generator

- New pure module `background/vault/credentials/passwordGenerator.ts`: `generatePassword(length = 20): string`, built only on `crypto.getRandomValues`. Charset and the exact length default get a short new subsection in `docs/data-model.md`.
- A "Generate" affordance next to the password input wherever M4's save-confirmation UI collects one, filling it in place of the user typing their own.
- **Acceptance**: unit tests for output length, charset membership, and that the implementation calls `crypto.getRandomValues` (never `Math.random`).

### M3 — Login-field detection + signup/login recognition

- New module (e.g. `background/firewall/loginDetector.ts`, deliberately not an extension of `classifier.ts` — decision 1) that, given a `DetectedForm`, finds a `type="password"` field and a paired identifier field, and classifies the form as `'login' | 'signup' | null` using the priority order in decision 1. `autocomplete` is already captured by `content/formDetection.ts` since Phase 3 — no content-script change needed for the primary signal.
- **Acceptance**: unit tests across representative fixtures — an `autocomplete`-tagged login form, an `autocomplete`-tagged signup form, a form with no `autocomplete` but a confirm-password field, and a bare fallback case — each classified correctly.

### M4 — Credential capture + save flow (simplest method only)

- `content/formDetection.ts` gains a submit listener (a genuinely new capability, per the "What already exists" section above) that, on a form M3 classified as `'login'` or `'signup'`, captures the typed identifier + password and reports it to the background.
- New session-state entry, mirroring Phase 3's pending-forms pattern: an unconfirmed captured credential per origin, surfaced through the **existing** toolbar badge (Phase 4's mechanism) as another kind of pending item — no new permission.
- Popup UI: a "Save this login for `{origin}`?" confirmation with Save/Discard, using M2's generator as an option if the captured password looks like it was newly typed (signup case) rather than an existing one (login case). Confirming calls the already-existing `SAVE_CREDENTIAL` message; discarding just drops the staged entry.
- **Acceptance**: manual — logging into or signing up on a real site raises the badge; opening the popup shows exactly what was typed; confirming persists it (verified via a follow-up `GET_CREDENTIAL` call); discarding leaves nothing behind.

#### M4 — Implementation (as built)

Built largely as planned, with one deliberate deviation from the plan's own text and two structural findings from `/code-review`:

- **The "offer M2's generator if the password looks newly typed" idea was dropped.** Working through the actual UX made the flaw obvious: by the time the save-confirmation screen renders, the form has *already been submitted* with whatever the user actually typed. Replacing that value with a freshly generated one before saving would save a credential that no longer matches what the site actually received — a login attempt with it would simply fail. The generator's real integration point is proactive, in-page, *before* submission — exactly Phase 8's territory, not an after-the-fact save prompt. M4 ships Save/Discard only, both saving exactly what was captured.
- **`content/formDetection.ts` gained its one, narrow exception to "structure, never values"**: `extractSubmittedFields`/`buildFormSubmittedMessage`, reporting live field values only for a form with a `type="password"` field, only at submit time. `entrypoints/content.ts`'s new capture-phase `submit` listener never calls `preventDefault()` — it must never interfere with the page's own real submission, the same principle that keeps the whole detection layer passive.
- **A real coordination problem, found while wiring the badge**: Phase 4 set the toolbar badge entirely from inside `handleFormDetected`'s own loop. A second, independent trigger (a captured credential) now also needs to change it, and two handlers each computing their own partial view of "what should the badge say" is exactly the kind of drift risk a Phase 5 M3 review already flagged for a different pair of modules. Resolved by caching `askCount` on `session/state.ts`'s own `OriginFormRecord` (computed once, by the handler that already has to do the expensive decrypt-and-resolve work anyway) and giving `background/badge.ts` one job: read that cached count, add one if a credential is pending, set the badge. `FORM_SUBMITTED`/`CONFIRM_PENDING_CREDENTIAL`/`DISCARD_PENDING_CREDENTIAL` now update the badge without touching the vault at all.
- **The tab-navigated-away re-verification check (`browser.tabs.get` + origin match + throw) was copy-pasted a third time** before `/code-review` caught it — `handleSubmitFieldDecisions` (Phase 3) and `handleSetHighTrustOrigin` (Phase 4) already had their own copies. Consolidated into `background/tabOriginGuard.ts`'s `assertTabShowsOrigin`, used by all three now.
- **A badge-update failure must never mask a real success.** `updateBadgeForTab` now catches its own errors internally (`console.debug`, never throws) — before this fix, a badge-write failure after a credential had already been successfully saved and cleared would still make the whole `CONFIRM_PENDING_CREDENTIAL` call reject, reporting a save failure for a credential that was, in fact, already safely in the vault.
- **`CONFIRM_PENDING_CREDENTIAL` cannot be exercised via Playwright at all** — confirmed directly, not assumed: its `assertTabShowsOrigin` check needs a genuinely-granted `activeTab` permission to see anything but a url-stripped `Tab` object, and `activeTab` only ever activates on a real, user-invoked toolbar click, which Playwright cannot produce (the same limitation Phase 1 M6 first documented, and `firewallApproval.test.ts` already documents again for the sibling "Pending request" section). The capture half of the pipeline (a real DOM submit event → the real content-script listener → a real `FORM_SUBMITTED` round trip → `GET_PENDING_CREDENTIAL`) has no such dependency and **is** exercised end to end in `tests/e2e/credentialCapture.test.ts`. `handleConfirmPendingCredential`'s own logic is fully covered by mocked-`tabs.get` unit tests instead, matching `handleSetHighTrustOrigin`/`handleSubmitFieldDecisions`'s own established convention; the popup's Save/Discard buttons remain a manual-verification item.

### M5 — Saved-credential list + autofill (plain, no masking)

- Popup section listing `GET_CREDENTIAL` results for the active tab's origin, shown plainly (decision 3 — no masking in this phase), with a Fill action per entry.
- `content/autofill.ts` extended to also write a username/password pair into the fields M3's login-detector locates, using the same native-setter + dispatched-event mechanism already proven for `PersonalData` fields in Phase 3. No auto-submit.
- **Acceptance**: manual — a credential saved in M4 correctly autofills a login form on a later visit to the same site.

#### M5 — Implementation (as built)

Built as planned — `FILL_CREDENTIAL` reuses `AUTOFILL_FIELDS` directly rather than inventing a second write-back message, and targets the first password-bearing form `detectLoginForm` recognizes regardless of its `'login'`/`'signup'` classification, since a person manually choosing to fill a specific credential is itself the confirmation that this is the right form. `/code-review` found real problems, though:

- **A literal contradiction of the plan's own confirmed decision**: the saved-credential list rendered the password as `type="password"`, masking it — decision 3 explicitly requires this list to show values plainly, no masking, in this phase. Fixed to `type="text"`.
- **`applyAutofill` had never had a reason to report anything back — until now.** Phase 3's automatic and manual auto-apply paths are both fire-and-forget by design; nothing ever checked whether a value actually landed. M5's *manual* Fill action is different: if the cached session-state form is stale (the live page changed since it was detected), silently reporting `filled: true` anyway is a real, visible lie to a person who just clicked a button expecting something to happen. Fixed by giving `applyAutofill` a `boolean` return (did it write anything at all), and — since `entrypoints/content.ts`'s `AUTOFILL_FIELDS` listener had never replied to anything before this — wiring an actual `sendResponse` reply through it for the first time, mirroring `background/router/dispatch.ts`'s own callback-plus-return-boolean convention. `handleFillCredential` now checks this reply instead of assuming success. Proven in a real browser, not just jsdom: `tests/e2e/credentialCapture.test.ts` sends a real `AUTOFILL_FIELDS` message directly and confirms the reply is `true` for a real match and `false` for a stale `formIndex`.
- **`fill()` was missing the re-entrancy guard its own sibling actions have.** `pendingCredential.store.ts`'s `confirm()`/`discard()` both guard against an overlapping call; the newly-added `fill()` didn't, until `/code-review` caught the gap.
- **A fourth independent copy of the same active-tab-resolution boilerplate** (`browser.tabs.query({active,currentWindow})` + null-check + `new URL(...).origin`) showed up across `firewall.store.ts`/`privacyLedger.store.ts`/`pendingCredential.store.ts`/`savedCredentials.store.ts` — the same repeated-code lesson the backend already learned once for a *different* check (`tabOriginGuard.ts`). Consolidated into `stores/shared/activeTab.ts`'s `resolveActiveTab()`, used by all four now.
- **Invalid HTML**: a `<p>` for the fill error sat as a direct child of a `<ul>`, which only permits `<li>` children. Moved outside the list.

### M6 — Deterministic per-site synthetic values

- ADR-016 written first, documenting the reuse of ADR-010's derivation pattern for this new purpose.
- `background/firewall/syntheticGenerator.ts`'s `generateSyntheticValue` derives its output from `HKDF(rootSecret, origin, fieldType)` instead of `crypto.randomUUID()`, reusing the existing per-origin key-derivation utility Service Identities already use. `generateNonsenseValue` is untouched (decision 5).
- **Acceptance**: unit tests confirming the same `(origin, fieldType)` pair produces byte-identical output across repeated calls, and that two different origins produce different output.

### M7 — Manual verification + docs sync

- Real-site pass covering every milestone above in sequence: enter personal data and confirm Real works; generate and save a password on a real signup; confirm the pending-save badge and popup flow on a real login; confirm autofill on a return visit; confirm Synthetic determinism by filling the same field on the same site twice and diffing the results.
- `docs/roadmap.md`'s Phase 5 section and `CLAUDE.md`'s status line updated to reflect completion.
- `/code-review` pass, fix real findings, commit, push.

## Gate to start Phase 6

Phase 6 (the Dashboard) needs a working credentials/personal-data layer to have anything to show across all sites at once. Before starting it, confirm:

- [ ] "Real" actually fills a live page's field with data the user entered through this phase's own UI — not just via a raw `sendMessage` call.
- [ ] A login captured on a real site can be confirmed, saved, and later auto-filled on a return visit.
- [ ] The same `(origin, fieldType)` always produces the same Synthetic value, confirmed live on a real site, not just in a unit test.
- [ ] No new browser permission was added — the save-prompt flow works entirely through the existing badge + popup mechanism.

**Phase 5 has not started.**
