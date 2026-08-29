# Phase 3 — Identity Firewall

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 3, weeks 8–11 (a size estimate, not a schedule — see the roadmap's own note on this, carried over from Phase 1/2's plans). **Objectives:** detect fields (not just forms), classify data types, identify apparently required vs. optional fields, an approval interface, block optional fields by default, and support four response actions: approve all, approve individually, deny, use an alias, use a synthetic value when appropriate.

This is the first phase where data actually crosses the trust boundary to a real site — everything before this (Phase 1's structural detection, Phase 2's vault) stayed entirely on-device. `docs/data-model.md` and `docs/privacy-model.md` already fully specify the target behavior (field sensitivity table, the five response types, the consent-flow mockups, the Policy Engine's rule shape); this plan is about building exactly that, no more, against the code that already exists.

## What already exists, confirmed by reading the actual code (not assumed)

- **Structural detection (Phase 1)**: `content/formDetection.ts` extracts `tagName`/`type`/`name`/`id`/`required` per field and fires a one-shot `FORM_DETECTED` message on `document_idle`. Its own header comment explicitly hands semantic classification to "Phase 3's Field Classifier" — this plan is that classifier.
- **Session state (Phase 1)**: `background/session/state.ts` currently stores only `{formCount, lastDetectedAt}` per origin — the actual field data is discarded after `FORM_DETECTED` is handled. Phase 3 needs the classified fields themselves to persist for the popup to act on.
- **The router already reserves a `'firewall'` capability** (`background/router/registry.ts`) — named in Phase 1 specifically so Phase 3's message types would land in the right place without a reshuffle. Still empty.
- **The response-type and sensitivity vocabulary is already schema-defined** in `shared/vault-schema.ts` (built ahead of need in Phase 2, for exactly this phase): `SensitivityLevelSchema` (`public`/`private`/`sensitive`/`highlySensitive`), `ResponseTypeSchema` (`real`/`alias`/`synthetic`/`nonsense`/`deny`), and — critically — `PERSONAL_DATA_FIELD_SENSITIVITY`, a static `keyof PersonalData -> SensitivityLevel` map that already matches `data-model.md`'s table exactly. This phase consumes these, it doesn't invent new ones.
- **`PersonalDataSchema` has exactly six fields**: `name`, `email`, `phone`, `nationalId`, `address`, `birthDate`. `data-model.md`'s sensitivity table also lists `country`/`language`/`timezone` as *Public* examples, but no vault field exists for them. **Decision: Phase 3 classifies only against these six known fields.** A field that doesn't map to one of them (a comment box, a country dropdown, a company name field) is classified `fieldType: null` and the Firewall does not act on it at all — no block, no prompt, no autofill. This is a deliberate scope boundary, not an oversight: inventing values for fields the vault has no data model for is a different, larger feature (arbitrary custom-field synthesis), and blocking a field we don't understand would risk breaking ordinary site functionality. Extending `PersonalDataSchema` with more field types is a future, separately-scoped addition if a real need shows up.
- **`AliasRecordSchema`/`AliasProviderConfigSchema` already exist** (Phase 2), defaulting to `provider: 'none'`, with an explicit code comment: *"Aliases provider integration is Phase 6's."* Confirmed with the user: **without a configured provider, "Alias" is disabled in the approval UI, falling back to "Ask"** — exactly `data-model.md`'s own stated default ("Alias, if an alias provider is configured; otherwise Ask"). No local fake-alias generator is built in Phase 3; that would risk silently handing the user a non-functional address.
- **Policy Engine automation and the Privacy Ledger are explicitly Phase 4's**, per both `docs/roadmap.md` (Phase 4's own objective list: "automatic policies," "record requests/disclosed/denied") and `shared/vault-schema.ts`'s own comments on `PolicyRuleSchema`/`PrivacyLedgerEntrySchema` ("schema-only in Phase 2 — Phase 4 owns the engine"). **Phase 3 asks the user every time a form is detected; nothing is remembered across visits, and nothing is logged.** This keeps the two phases' scope boundary exactly where the codebase already drew it.
- **Government/financial "safe mode" is Phase 4's**, per its own roadmap objective ("exceptions for government/financial services"). Phase 3 does not attempt site-trust classification.
- **Content script currently only sends messages, never listens.** Autofill (writing resolved values back into the page) needs a new background → content-script message path that doesn't exist yet in any phase so far.

## Key design decisions

1. **Classification happens in the background, not the content script.** The content script keeps doing exactly what its Phase 1 header comment says — raw structural extraction, nothing semantic. `background/firewall/classifier.ts` classifies each `DetectedField` when `FORM_DETECTED` arrives. This keeps the "content script touches page content, background makes decisions" split from `browser-architecture.md` intact.
2. **`DetectedFieldSchema` gains one new raw attribute: `autocomplete`.** Still raw structural data (a literal HTML attribute, no judgment involved), so it belongs in Phase 1's extraction layer, not the classifier — but it's a materially better classification signal than `name`/`id` alone (it's the actual browser-standard hint for exactly this purpose), so it's worth the one-field schema extension before building the classifier around it.
3. **Classification heuristic, in priority order**: (a) `input[type]` (`email` → email, `tel` → phone), (b) the WHATWG `autocomplete` token (`email`, `tel`, `name`, `bday`, `street-address`/`address-line1`), (c) a `name`/`id` regex fallback with both English and Portuguese synonyms (`cpf`, `nascimento`, `telefone`, `endereco`/`endereço` alongside `email`, `phone`, `birthdate`, `address`) — Portuguese because `nationalId`'s own doc-level name is literally "CPF," a Brazilian identifier, so real-world forms this needs to handle will often be in Portuguese.
4. **`apparentlyRequired` is a direct passthrough of the HTML `required` attribute** — no additional inference. `data-model.md`'s "optional is not ground truth" point is about how the *UI* treats this signal (a hedge, not settled fact), not about the classifier needing smarter detection logic it has no way to actually verify (it can't see server-side validation).
5. **A response-type availability matrix, gating what the approval UI can offer per field, derived directly from `data-model.md`'s sensitivity table and its own explicit safety caveat** (never fabricate highly-sensitive data):

   | Sensitivity | Field(s) | Available responses |
   |---|---|---|
   | Private | `email` | Real, Synthetic, Nonsense, Deny, **+ Alias only if `aliasProviderConfig.provider !== 'none'`** |
   | Sensitive | `name`, `phone`, `address`, `birthDate` | Real, Synthetic, Nonsense, Deny |
   | Highly sensitive | `nationalId` | **Real, Deny only** — no Synthetic/Nonsense, matching `data-model.md`'s explicit warning that fabricated highly-sensitive data (a fake CPF) can break the user's own account or violate a legal requirement, not just "look bad" |

   "Real" is additionally only offered when `PersonalData` actually has a value for that field — there's nothing to disclose otherwise.
6. **Synthetic values use the reserved `.invalid` TLD (RFC 2606) for email** (`synthetic.<n>@example.invalid`), guaranteeing the address is non-deliverable and unambiguously fake rather than accidentally routable to a real domain. Other synthetic fields (name, phone, address, birth date) use fixed, obviously-placeholder-shaped values. Nonsense values are deliberately absurd, matching `privacy-model.md`'s own example ("Xablau 9000").
7. **The approval UI lives in the popup, not an injected in-page overlay.** A content-script-rendered overlay (Shadow DOM, styled to survive arbitrary host-page CSS) is a real, separately-scoped UI project on its own — real password managers spend significant effort here. Phase 3 ships the popup-based flow the existing `App.vue`/Pinia pattern already supports, with the toolbar badge (`browser.action.setBadgeText`) as the "you have a pending request" signal. An injected in-page prompt is a plausible future polish item, explicitly deferred, not silently dropped.
8. **Autofill write-back must dispatch native `input`/`change` events, not just set `.value`.** Programmatically setting `element.value` alone is invisible to frameworks (React, Vue) that track form state via their own controlled-input machinery — a well-known real-world autofill gotcha. This needs verification against a framework-driven form, not just a plain HTML fixture, before M6 is considered done.

## Milestone breakdown

### M1 — Field Classifier (pure logic)

- `shared/messages.ts`: add `autocomplete: z.string().nullable()` to `DetectedFieldSchema`.
- `content/formDetection.ts`: `extractField` reads `el.autocomplete` (present on all three detectable element types).
- `background/firewall/classifier.ts` (new, fills the reserved `'firewall'` capability's first module):
  - `export interface ClassifiedField extends DetectedField { fieldType: keyof PersonalData | null; sensitivity: SensitivityLevel | null; apparentlyRequired: boolean }`
  - `classifyField(field: DetectedField): ClassifiedField` — the three-tier heuristic from design decision 3.
  - `classifyForm(form: DetectedForm): ClassifiedForm` (maps `classifyField` over `form.fields`).
- **Acceptance**: one unit test per `PersonalData` field type confirming each detection path (type-based, autocomplete-based, name/id-regex-based) independently classifies correctly; a field matching none of them (e.g. a `<textarea name="message">`) classifies `fieldType: null`.

#### M1 — Implementation (as built)

Built as planned. `ClassifiedField`/`ClassifiedForm` ended up defined as Zod schemas in `shared/messages.ts` rather than plain interfaces in `classifier.ts` itself (re-exported from there for callers) — needed so `GET_PENDING_REQUEST`'s response type (M2) could reference them without `shared/` importing from `background/` or vice versa, the same layering `DetectedField`/`DetectedForm` already established. One real bug caught by review: the email synonym list's original `'e-mail'` entry could never match anything, since the tokenizer splits on every non-alphanumeric character including the hyphen — fixed to `'mail'`.

### M2 — Session state + the pending-request message

- `background/session/state.ts`: `OriginFormRecord` gains `forms: ClassifiedForm[]` (the actual classified structure, not just a count) — `formCount` becomes `forms.length` and can be dropped or derived.
- `background/formDetection/handler.ts`: `handleFormDetected` classifies via `classifier.ts` before calling `recordFormDetection`.
- `shared/messages.ts`: new `GetPendingRequestMessageSchema` (`GET_PENDING_REQUEST`, payload `{ origin: string }`) — deliberately a new message type rather than overloading the existing `GET_ORIGIN_STATE` (which returns a lightweight count for the "sites visited" list, a different purpose from the approval UI's full classified-field view).
- `background/firewall/handler.ts` (new): `handleGetPendingRequest` reads session state for that origin, returns the classified forms (or `null`).
- `background/router/registry.ts`: `GET_PENDING_REQUEST` → capability `'firewall'`.
- **Acceptance**: `FORM_DETECTED` for a form with a recognizable `email` field, followed by `GET_PENDING_REQUEST` for that origin, round-trips the classification correctly through session storage.

#### M2 — Implementation (as built)

`GetPendingRequestResponse` ended up richer than this bullet's original `ClassifiedForm[] | null` sketch — see M3/M4's as-built notes below for why (`availableResponses` needed to travel with it). Otherwise built as planned. A toolbar-badge update (`browser.action.setBadgeText`, the recognized-field count for the sending tab) was folded into `handleFormDetected` here rather than deferred to M4, since it's driven by the exact same classification result this milestone already computes — no reason to compute it twice or store it separately just to match the plan's original milestone boundary.

### M3 — Response Generator + availability matrix

- `background/firewall/responseAvailability.ts`: `availableResponses(fieldType, hasRealValue, aliasProviderConfigured): ResponseType[]`, implementing design decision 5's table exactly.
- `background/firewall/syntheticGenerator.ts`: `generateSyntheticValue(fieldType): string` and `generateNonsenseValue(fieldType): string`.
- `background/firewall/responseGenerator.ts`: `generateResponseValue(fieldType, responseType, personalData): string | null` — `real` reads `personalData[fieldType]`, `synthetic`/`nonsense` delegate to the generators above, `deny` returns `null` (meaning: don't fill this field, don't send it).
- **Acceptance**: unit tests confirming the availability matrix matches design decision 5's table exactly (including the highly-sensitive real-or-deny-only restriction), and that synthetic email values always end in `.invalid`.

#### M3 — Implementation (as built)

Built as planned, no surprises. `generateSyntheticValue`/`generateNonsenseValue` throw (rather than silently returning something) if ever called for `nationalId` — a defensive invariant check, not expected to be reachable given `responseAvailability.ts` never offers Synthetic/Nonsense for a highly-sensitive field, but cheap to assert loudly if that ever changes.

### M4 — Approval UI (popup)

- New Pinia store, `stores/firewall.store.ts`, following `session.store.ts`'s established shape (refetch-on-mount, `MessageResponse` handling, no direct `browser.storage` access).
- Popup needs the **active tab's origin** for the first time in this project — `browser.tabs.query({ active: true, currentWindow: true })` inside the store's fetch action.
- New Vue component (`entrypoints/popup/FirewallApproval.vue` or an added section of `App.vue`, decided during implementation based on how large the resulting template gets) rendering the mockup from `privacy-model.md`: per-field sensitivity badge, apparent-required/optional badge, a response-type picker constrained to `availableResponses`, "Approve all" (applies each field's sensitivity-appropriate default), and "Deny optional fields."
- `browser.action.setBadgeText` reflects a pending request's field count when a form is detected on the active tab.
- **Acceptance**: manual — open a real page with a recognizable form, confirm the popup shows the correct classified fields with the correct available response options per field.

#### M4 — Implementation (as built)

- **`availableResponses` moved server-side into `GET_PENDING_REQUEST`'s own response**, computed by `handleGetPendingRequest` from `PersonalData` and `aliasProviderConfig` (both vault-only, neither reachable from the popup directly) rather than duplicated as a second client-side copy of `responseAvailability.ts`'s logic — one source of truth, the same logic `handleSubmitFieldDecisions` re-validates against. `GetPendingRequestResponse` is therefore `{ forms, availableResponses } | null`, not the bare `ClassifiedForm[] | null` this milestone's own bullet (and M2's) originally sketched.
- **A real, non-obvious permission gap, found only by actually running this in a browser**: `browser.tabs.query({active, currentWindow})` with *no* tab-related permission at all returns a `Tab` object with `url`/`title` stripped — `firewall.store.ts` had nothing to resolve an origin from. Fixed by adding `'activeTab'` to `wxt.config.ts`'s manifest permissions — deliberately not the broader `'tabs'` permission (which would show Chrome's "read your browsing history" warning and grant standing visibility into every tab, not just the one the user is currently looking at). `'activeTab'` is the minimal permission Chrome designed for exactly this "popup wants to know about the current tab" pattern, matching `docs/security-model.md`'s own "minimal permissions" principle.
- **Known, accepted limitation this permission choice creates**: `activeTab` only activates on a real, user-invoked click on the extension's toolbar icon — something Playwright cannot simulate at all (the same "can't click a real toolbar icon" limitation Phase 1's M6 already documented). So in every e2e test, `tabs.query` behaves exactly as if the permission were entirely absent. This makes the full detect → approve → autofill loop a **manual verification requirement** (see M6 below), not something asserted end-to-end in the automated suite — `tests/e2e/firewallApproval.test.ts` instead asserts the *graceful degradation* path (a clear "Could not determine the active tab" message, not a crash or a silently blank section), which is exactly the state Playwright itself is permanently stuck in.
- Approval UI landed as a new section inside the existing `entrypoints/popup/App.vue` (not a separate `FirewallApproval.vue`) — the added template stayed small enough that a second file would have been pure ceremony, matching this project's general anti-premature-abstraction stance.
- `stores/firewall.store.ts` keys its `decisions` map by `` `${formIndex}:${fieldKey}` ``, not `fieldKey` alone — two different forms on the same page could otherwise share a field name (e.g. both a login and signup form present with an "email" field) and silently collide on one decision.

### M5 — Submit decisions + autofill round-trip

- `shared/messages.ts`: `SubmitFieldDecisionsMessageSchema` (`SUBMIT_FIELD_DECISIONS`, popup → background, payload `{ origin, formIndex, decisions: Record<string, ResponseType> }` keyed by field `name`/`id`) and `AutofillFieldsMessageSchema` (`AUTOFILL_FIELDS`, background → content, payload `{ formIndex, values: Record<string, string> }` — only fields resolving to a non-null value are included, `deny` fields are simply absent).
- `background/firewall/handler.ts`: `handleSubmitFieldDecisions` resolves each decision via `responseGenerator.ts`, then relays the resolved values to the originating tab via `browser.tabs.sendMessage(tabId, autofillMessage)` — the sender's `tab.id`, captured from `HandlerContext.sender`, is what makes this tab-scoped rather than broadcast.
- `entrypoints/content.ts`: add a `browser.runtime.onMessage` listener (new — the content script has only ever sent messages before this) that, on `AUTOFILL_FIELDS`, finds each field by `formIndex` + `name`/`id`, sets its value using the native property setter (not the framework-shadowed one, per design decision 8), and dispatches real `input`/`change` events.
- **Acceptance**: a Playwright e2e test against a plain HTML fixture form (extending `tests/e2e/fixtures/server.ts`'s pattern from Phase 1) confirming approve-all correctly fills recognizable fields; a *second* e2e test against a minimal React-controlled-input fixture, confirming the native-setter technique actually works there too (design decision 8's stated risk) — if this fails, Vue's own controlled-input shadowing needs the same verification given the popup is itself Vue, though the target page's framework (not the extension's) is what matters here.

#### M5 — Implementation (as built)

- **`tabId` travels explicitly in `SUBMIT_FIELD_DECISIONS`'s own payload, not read off `HandlerContext.sender`** — this milestone's own bullet above assumed the sender's `tab.id` would make the relay tab-scoped "for free," but that's only true for a message sent *from a content script*. `SUBMIT_FIELD_DECISIONS` is sent by the **popup** (an extension page with no tab of its own), so `sender.tab` is always `undefined` for it. The popup captures the active tab's id itself (the same `browser.tabs.query()` call already needed for `GET_PENDING_REQUEST`'s origin) and passes it through.
- **`handleSubmitFieldDecisions` re-derives each field's `fieldType` from the session's own already-classified record**, never trusting anything about a field's type from the client — the popup only ever sends `{ key -> ResponseType }`. It also re-validates each decision against `availableResponses()` before generating a value, failing loudly (not silently substituting) if a decision falls outside what's actually allowed for that field.
- **The planned React-controlled-input fixture test was not built** — the automated e2e suite can't reach this far at all, for the same `activeTab`/Playwright-can't-click-the-toolbar reason M4's as-built notes describe (there's no way to get past the approval UI to trigger autofill in the first place). `content/autofill.ts`'s native-setter technique is instead covered by a jsdom unit test (`tests/unit/content/autofill.test.ts`) confirming plain `<input>`/`<textarea>`/`<select>` all receive the value and fire `input`/`change` — a real React/Vue-controlled-input fixture is deferred to M6's manual verification pass.

### M6 — Full-loop verification and docs

- **The full detect → classify → approve → autofill loop needs manual verification in a real browser** — M4's as-built notes above explain why: `activeTab` never activates under Playwright, so no automated test can drive the popup against a real active tab end-to-end. This mirrors Phase 2's M9 (WebAuthn can't be scripted either) — same category of gap, same resolution.
- Manual pass against a handful of real signup forms (not just the fixture page) to sanity-check the classifier's real-world hit rate — an honest record of what it does and doesn't recognize correctly belongs in this milestone's "as built" notes, not an unstated assumption.
- `docs/data-model.md`/`docs/privacy-model.md`: no changes expected (this phase implements what they already specify) unless real-world testing surfaces a genuine gap in the documented design.
- `/code-review` pass, fix real findings, commit, push — same rhythm as every Phase 2 milestone.

## Gate to start Phase 4

Phase 4 builds the Policy Engine (remembers decisions, auto-applies them) and the Privacy Ledger (logs every disclosure) *on top of* Phase 3's per-request flow. Before starting it, confirm:

- Every field the classifier recognizes correctly maps to the right `PersonalData` key and sensitivity level on at least a handful of real, unrelated signup forms — not just the fixture page.
- A user can complete the full loop — form detected → popup shows correct classified request → user decides per field → site's form is actually filled — without touching any code, on a real site.
- Optional fields are, in practice, blocked by default and never silently pre-filled.
- Nothing from this phase writes to `Policies` or `PrivacyLedger` — confirmed by grep, not assumed — since Phase 4 owns bringing those trees to life and Phase 3 building ahead into them would blur the boundary this plan deliberately drew.
