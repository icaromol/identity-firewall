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

### M5 — Saved-credential list + autofill (plain, no masking)

- Popup section listing `GET_CREDENTIAL` results for the active tab's origin, shown plainly (decision 3 — no masking in this phase), with a Fill action per entry.
- `content/autofill.ts` extended to also write a username/password pair into the fields M3's login-detector locates, using the same native-setter + dispatched-event mechanism already proven for `PersonalData` fields in Phase 3. No auto-submit.
- **Acceptance**: manual — a credential saved in M4 correctly autofills a login form on a later visit to the same site.

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
