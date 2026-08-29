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

### M7 — Full-loop verification and docs

- Manual pass confirming: a policy set once is genuinely not asked again on a second visit to the same site; a high-trust site always interrupts regardless of policy; the Ledger accurately reflects both automatic and manual disclosures.
- `/code-review` pass, fix real findings, commit, push.

## Gate to start Phase 5

Phase 5 adds biometric authorization gating sensitive disclosures — `authorizationMethod` (decision 7) starts getting populated for real. Before starting it, confirm:

- A `'real'`/`'alias'`/`'synthetic'`/`'nonsense'`/`'deny'` policy, once set for a field, is applied automatically on every subsequent visit without prompting — confirmed on a real site across two separate page loads.
- A highly-sensitive field (`nationalId`) can never resolve to anything but `'ask'` or `'deny'` even via policy — confirmed by the resolution logic never accepting a stored `'real'`/`'synthetic'`/`'nonsense'` rule for it (mirrors Phase 3's own availability-matrix restriction, now enforced at the policy layer too).
- The Privacy Ledger has a correct, inspectable entry for every disclosure this phase's code can produce, automatic or manual.
- Government/financial safe mode cannot be silently bypassed by a stored policy rule for that origin.
