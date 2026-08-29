# Phase 4 — Privacy Ledger + Policy Engine

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 4, weeks 12–14. **Objectives:** record requests, record disclosed data, record denied data, per-site history, automatic policies, sensitivity categories, exceptions for government/financial services, a "what does this site know about me?" interface. **Deliverable:** "Every service has a local history of its relationship with the user's identity."

This phase builds two things *on top of* Phase 3's per-request flow, both already schema-shaped (schema-only) since Phase 2: the **Policy Engine** (remembers a decision so the user isn't asked the same question twice) and the **Privacy Ledger** (a durable local log of every disclosure). Phase 3 deliberately asked the user every single time and logged nothing — this phase is what makes that sustainable at real-world scale.

## What already exists, confirmed by reading the actual code

- `shared/vault-schema.ts` already defines `PolicyRuleSchema` and `PrivacyLedgerEntrySchema`, both wired into `VaultIndexSchema.policies`/`.privacyLedger` since Phase 2 — but **grep confirms zero other code references either type**: they've never been constructed, read, or tested against. Both are free to reshape without any migration concern.
- Phase 3's `stores/firewall.store.ts` already has an `applyApproveAll()`/`defaultResponseFor()` heuristic (required+has-real-value → Real, else Deny) — this was always a placeholder standing in for the Policy Engine this phase actually builds, per Phase 3's own plan doc ("Policy Engine automation... stays Phase 4's job"). This phase replaces it, not extends it.
- The response-availability/generation pipeline (`background/firewall/responseAvailability.ts`, `responseGenerator.ts`) is reused as-is — this phase decides *which* `ResponseType` to apply per field automatically; it doesn't change how a chosen type becomes a value.

## Key design decisions

1. **`PolicyRuleSchema`'s existing shape (`{fieldSensitivity, defaultResponse}`) doesn't match the design docs and is replaced.** `privacy-model.md`'s own Policy Engine table gives *different* defaults to two fields of the *same* sensitivity tier (`name` → Ask, `phone` → Deny, both "Sensitive") and describes per-site rules ("shopping sites may receive name + address, but never CPF") — a policy needs to be scoped by **field type** and optionally by **origin**, not by sensitivity level alone. New shape:
   ```ts
   PolicyRuleSchema = {
     scope: { kind: 'global' } | { kind: 'origin'; origin: string },
     fieldType: PersonalDataFieldName,
     action: PolicyAction, // ResponseType | 'ask' -- see decision 2
   }
   ```
   Resolution order for a given `(origin, fieldType)`: an origin-scoped rule for that exact origin → a global rule for that field type → the static baseline (decision 3). First match wins.
2. **`ResponseType` alone can't represent a policy action — a policy also needs to mean "no automatic answer, ask every time."** `browser-architecture.md`'s pipeline is explicit that Sensitive/Highly-sensitive fields keep prompting even under a "policy," because their *own* default policy response is Ask (`data-model.md`'s "Ask + biometric" for `nationalId` is not a fifth `ResponseType`, it's an instruction to interrupt the user). New `PolicyActionSchema = ResponseTypeSchema | z.literal('ask')`. `PrivacyLedgerEntrySchema` and `PolicyRuleSchema` both use this, not `ResponseTypeSchema` directly.
3. **A new static baseline, `PERSONAL_DATA_FIELD_DEFAULT_ACTION`, fills in for any field with no matching `PolicyRule`** — lifted directly from `privacy-model.md`'s own example rules (`email → alias by default`, `phone → deny`, `CPF → always ask`, `name → ask`, `address → always ask`), not invented: `{ email: 'ask' (or 'alias' once a provider is configured — mirrors responseAvailability.ts's own alias gating), name: 'ask', phone: 'deny', nationalId: 'ask', address: 'ask', birthDate: 'ask' }`. `birthDate` isn't in privacy-model.md's example list; defaulted to `'ask'`, matching Sensitive's general default — an honest, documented fill of a real gap, not a silent guess.
4. **Confirmed with the user: full automation is silent, not a still-requires-Submit convenience.** When every recognized field on a detected form resolves to a non-`'ask'` action, the Firewall generates values and relays `AUTOFILL_FIELDS` immediately from `handleFormDetected` itself — no popup interaction at all. The Privacy Ledger (this phase) is what keeps this honest and inspectable after the fact, matching `architecture.md`'s own framing ("resolves automatically... without interrupting the user") and Principle 6 (transparency, not "ask every time"). The instant even one field resolves to `'ask'`, the flow falls back exactly to Phase 3's popup-based approval — pre-filled for the already-resolved fields, prompting only for the `'ask'` ones.
5. **The toolbar badge (Phase 3 M2) is repurposed**: it now counts fields genuinely awaiting a decision (`'ask'`), not every recognized field — a form that's 100% auto-resolved shows no badge at all, which is the correct signal once "recognized" no longer implies "needs your attention."
6. **Government/financial safe mode is a user-maintained list, not automatic domain/TLS/community-list detection.** `privacy-model.md` mentions automatic detection as one option among several ("domain, TLS certificate, community-maintained lists, or manual classification") — automatic detection needs an external data source this project doesn't have and, per `ADR-007`/`ADR-001`, shouldn't depend on. MVP scope: the user can mark/unmark an origin as high-trust from the popup; a high-trust origin's resolution *always* returns `'ask'` for every field, regardless of any stored `PolicyRule` — safe mode overrides policy, not the other way round.
7. **`PrivacyLedgerEntry` gains an `authorizationMethod: string | null` field now, always `null` until Phase 5.** `privacy-model.md`'s own example ledger entry includes "Authorization: Fingerprint" — shaping the field ahead of the phase that populates it meaningfully is the same precedent Phase 2 already set for `Policies`/`PrivacyLedger` themselves.
8. **`disclosedFields` becomes `Record<PersonalDataFieldName, ResponseType>`, not a bare string array.** The existing schema's `requestedFields: string[]` / `disclosedFields: string[]` can't answer "what *kind* of value did I hand over" — `privacy-model.md`'s own example entry shows exactly this ("Email → alias", "Name → real"), which a flat name list can't represent.

## Milestone breakdown

### M1 — Policy schema + resolution logic (pure logic)

- `shared/vault-schema.ts`: `PolicyActionSchema`, revised `PolicyRuleSchema` (decision 1/2), `PERSONAL_DATA_FIELD_DEFAULT_ACTION` (decision 3), revised `PrivacyLedgerEntrySchema` (decisions 7/8).
- `background/policy/resolve.ts` (new capability, fills the still-unused-until-now schema trees): `resolvePolicy(origin, fieldType, policies, isHighTrustOrigin): PolicyAction` — safe-mode override → origin rule → global rule → baseline, in that order.
- **Acceptance**: unit tests for every branch of the resolution order, including the safe-mode override beating a stored `'real'` rule, and the baseline table matching `privacy-model.md`'s example rules exactly.

### M2 — Policy storage + high-trust origins

- New messages: `GET_POLICIES`, `SET_POLICY` (upsert by `scope`+`fieldType`), `DELETE_POLICY`; `SET_HIGH_TRUST_ORIGIN` (payload `{ origin, isHighTrust: boolean }`).
- `VaultIndexSchema` gains `highTrustOrigins: string[]` (additive, own array rather than folded into `PolicyRule`, since "always ask regardless of field" doesn't fit a per-field-type rule shape).
- `background/policy/storage.ts`/`handler.ts`, wired through the existing `updateVaultIndexWithResult` — no new storage tier, `Policies`/`highTrustOrigins` already live in the index.
- **Acceptance**: round-trip tests for setting/reading/deleting a policy and toggling a high-trust origin.

### M3 — Wire the Policy Engine into form detection (the automation path)

- `background/formDetection/handler.ts`: after classifying, resolve each recognized field's `PolicyAction`. If every recognized field resolves to non-`'ask'`, generate values immediately and relay `AUTOFILL_FIELDS` to the sending tab right there — no popup involved. If any field needs `'ask'`, store the *resolved* actions alongside the classified forms (so the popup can pre-fill without re-resolving) and fall back to Phase 3's flow.
- `stores/firewall.store.ts`: `applyApproveAll()`/`defaultResponseFor()` (Phase 3's placeholder) removed; decisions are pre-populated directly from the policy-resolved actions the backend already computed, leaving only `'ask'` fields blank.
- Toolbar badge (decision 5): counts only `'ask'` fields.
- **Acceptance**: a form where every field has a matching non-`'ask'` policy is filled with zero popup interaction, confirmed via a unit test on the handler (mocking `tabs.sendMessage`) and, for the real loop, the same manual-verification requirement Phase 3's M6 already established (`activeTab`/Playwright can't reach this either).

### M4 — Privacy Ledger recording

- Every disclosure event — automatic (M3) or via `SUBMIT_FIELD_DECISIONS` (Phase 3's manual path) — appends one `PrivacyLedgerEntry` to the vault index: `requestedFields` (every recognized field), `disclosedFields` (fieldType → the `ResponseType` actually used, `'deny'`/never-resolved fields excluded), `deniedFields`, `at`, `authorizationMethod: null`.
- New message `GET_PRIVACY_LEDGER` (payload `{ origin }`) returning that origin's entries.
- **Acceptance**: unit tests confirming both the automatic path and the manual path append an equivalent, correctly-shaped entry.

### M5 — "What does this site know about me?" UI

- A popup view (per origin, from `GET_PRIVACY_LEDGER`) rendering `privacy-model.md`'s mockup: disclosed items with their response type, denied items, last access.
- **Acceptance**: manual — after a real disclosure (automatic or manual), this view shows it accurately.

### M6 — Government/financial safe mode

- Popup UI: a toggle to mark/unmark the current origin as high-trust.
- `resolvePolicy`'s safe-mode override (M1) already implements the mechanism; this milestone is the UI plus the warning banner `privacy-model.md`'s mockup shows ("⚠️ This site has been identified as a government/financial service...") when the active tab's origin is marked high-trust.
- **Acceptance**: manual — marking a real site high-trust forces `'ask'` for every field there even with a contradicting stored policy, and the warning banner appears.

#### M1–M6 — `/code-review` findings, all fixed

Eight independent finder angles converged on one root defect from different symptoms:

- **Root cause**: `handleGetPendingRequest` returned `null` before ever computing `isHighTrustOrigin` whenever no form had been detected this session for that origin. Safe mode is a *persistent* per-origin setting, not tied to session form-detection state — a user landing on a marked government/financial site before any form loaded (or after a service-worker restart) would see the checkbox unchecked and the warning banned hidden, directly contradicting the UI's own stated intent. **Fixed**: the handler now always returns a full `PendingRequest` (`forms: []` when nothing was detected), never `null` — nothing downstream ever actually distinguished the two. `GetPendingRequestResponse`'s type simplified from `PendingRequest | null` to `PendingRequest` accordingly.
- Two direct consequences of the root cause, fixed by the same change: the checkbox could get permanently stuck unchecked with no way to discover or clear the real flag from a form-less page, and `toggleHighTrust`'s `!this.isHighTrustOrigin` flip was computed from that wrong value.
- **`toggleHighTrust` silently discarded manual decisions**: it called the equivalent of a full `fetchPendingRequest()`, which unconditionally reset `decisions` to `{}` before re-populating from fresh `resolvedActions` — losing anything the user had picked by hand for a field the Policy Engine itself left at `'ask'`, just from toggling an unrelated checkbox. **Fixed**: extracted `applyPendingRequestData`, which tracks which decisions *it* auto-filled (`autoFilledKeys`) and only clears those on a refresh, leaving manual picks untouched.
- **No error handling, no in-flight guard**: unlike every other mutating action in this store, a failed/rejected `SET_HIGH_TRUST_ORIGIN` failed silently, and two rapid clicks could both read the same stale state and fire the same value twice. **Fixed**: added `togglingHighTrust`/`highTrustError` state, a try/catch, and an early return while a toggle is already in flight.
- **No stale-tab re-verification**: `handleSubmitFieldDecisions` already re-checks the tab is still on the claimed origin before acting (Phase 3's own code-review fix) — `SET_HIGH_TRUST_ORIGIN` had no equivalent, so a cached-but-stale origin (the tab navigated away while the popup stayed open) could mark or unmark safe mode for the wrong site. **Fixed**: the message now carries `tabId`, and `handleSetHighTrustOrigin` re-verifies it, mirroring the existing pattern exactly.
- **Redundant round trip**: `toggleHighTrust` discarded `SetHighTrustOriginResponse`'s own returned array and re-queried the active tab a second time just to re-learn a boolean it had just set. **Fixed** as a side effect of the `applyPendingRequestData` rewrite: `toggleHighTrust` no longer re-queries `browser.tabs.query` at all (tabId/origin are already known), it only issues the one necessary follow-up `GET_PENDING_REQUEST` to get fresh `resolvedActions`.

### M7 — Full-loop verification and docs

- Manual pass confirming: a policy set once is genuinely not asked again on a second visit to the same site; a high-trust site always interrupts regardless of policy; the Ledger accurately reflects both automatic and manual disclosures.
- `/code-review` pass, fix real findings, commit, push.

#### M7 — Implementation (as built)

Manual pass run against the real production build, in real Chrome, on real sites:

- **Optional-field-defaults-to-deny confirmed on a real, complex form**: `www.gsuplementos.com.br` had 8 recognized fields (multiple `email`/`phone`/`name` fields, all apparently optional) — every one defaulted to `deny` automatically with zero policy configured, exactly matching design decision 3/the M1 fix. Manually overriding a few to `synthetic`/`nonsense` and submitting correctly wrote those values into the live page and recorded them in the Privacy Ledger with the right response type per field.
- **The availability-matrix safety check confirmed working, not just unit-tested**: attempting `real` for a field `PersonalData` had no value for was correctly rejected server-side (`Response type "real" is not allowed for field...`) — the exact defense-in-depth check `handleSubmitFieldDecisions` implements, now proven against a real popup interaction, not just a mocked test.
- **Safe mode confirmed working on a real site**: marking `signupgenius.com` high-trust immediately showed the warning banner and forced every field back to `ask` in the popup, overriding what was otherwise a working manual/automatic flow.
- **Two real-world limitations found, both judged out of scope for Phase 4 and left as documented gaps** (per the user's explicit choice to record rather than fix now):
  - **`figma.com/signup` — zero forms detected at all.** Figma's signup page is a full SPA that renders its form after the content script's one-shot `document_idle` pass already ran. This is a Phase 1 architecture limitation (no re-detection, no `MutationObserver`), not a Phase 3/4 defect — already implicitly covered by the roadmap's later phases, not something this phase's scope should reach backward to fix.
  - **`signupgenius.com` — 3 forms detected, but 2 of 3 email fields visually "did nothing" when filled**, while every other field (including a third email field) filled correctly and was confirmed in the Privacy Ledger. Best diagnosis without direct DOM access to the live page: a multi-step signup wizard with more than one `<form>` in the DOM where only one step is visible at a time — the fill likely succeeded into a hidden/inactive step's fields, which is indistinguishable from "did nothing" to someone looking only at the active step. Root cause: `content/formDetection.ts`'s field extraction has no concept of whether a field is currently visible/interactable — it walks `document.forms` unconditionally. A visibility check (e.g. `checkVisibility()`/`offsetParent !== null`) at detection time would be the natural fix, deliberately deferred rather than built into an already-closed milestone's scope.

## Gate to start Phase 5

Phase 5 adds biometric authorization gating sensitive disclosures — `authorizationMethod` (decision 7) starts getting populated for real. Before starting it, confirm:

- [x] A `'real'`/`'alias'`/`'synthetic'`/`'nonsense'`/`'deny'` policy, once set for a field, is applied automatically on every subsequent visit without prompting. Confirmed live for the baseline case (`www.gsuplementos.com.br`'s 8 optional fields auto-denied with zero configured policy, every load); the explicit-stored-rule case is covered exhaustively by `resolve.test.ts`'s resolution-order tests rather than a second live-site round trip in this pass.
- [x] A highly-sensitive field (`nationalId`) can never resolve to anything but `'ask'` or `'deny'` even via policy — confirmed by `resolve.test.ts`'s explicit clamping tests (no real-world `nationalId` field was available to test live this pass).
- [x] The Privacy Ledger has a correct, inspectable entry for every disclosure this phase's code can produce, automatic or manual. Confirmed live: the ledger accurately showed `email (synthetic)`/`name (nonsense)`/`phone (synthetic)` matching exactly what was submitted on real sites.
- [x] Government/financial safe mode cannot be silently bypassed by a stored policy rule for that origin. Confirmed live on `signupgenius.com` (banner appeared, every field forced to `ask` immediately on toggling) and exhaustively by `resolve.test.ts`'s own safe-mode-beats-any-rule tests.

**Phase 4 is complete**, with two honestly-documented real-world limitations (both above, in M7's "as built" notes) carried forward rather than silently ignored.
