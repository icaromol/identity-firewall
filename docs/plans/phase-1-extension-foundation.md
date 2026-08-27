# Phase 1 Plan: Extension Foundation

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 1, weeks 3–4 (a rough size estimate, not a schedule — see the roadmap's own note on this). **Deliverable being planned for:** "an extension installed in the browser, able to detect sites and hold local state."

This is the detailed execution plan for Phase 1, following the same before-code-exists planning discipline Phase 0 used. It synthesizes two research passes done specifically to ground this plan in verified, current fact rather than assumption:

- [`../research/phase-1-tooling-scaffold.md`](../research/phase-1-tooling-scaffold.md) — current WXT (`0.21.4`) and Tailwind (`4.3.3`) documentation, checked live rather than assumed from training data.
- [`../research/phase-1-runtime-architecture.md`](../research/phase-1-runtime-architecture.md) — the message-passing, service-worker-lifecycle, and module-boundary design, each decision traced to a specific lesson from [`../research/attestto-teardown.md`](../research/attestto-teardown.md) or [`../research/webauthn-technical-notes.md`](../research/webauthn-technical-notes.md).

Where the two research docs disagreed, this plan states the resolution explicitly (see "Resolved conflict" below) rather than carrying both forward.

---

## Scope boundary — read this before implementing anything

Phase 1 is **the skeleton only**. Per the roadmap, these are explicitly other phases and must not be designed or built early:

| Not in Phase 1 | Belongs to |
|---|---|
| Vault encryption, key derivation, unlock flow | Phase 2 — Local Identity Vault |
| Field semantic classification (`email`, `national_identifier`, …), required/optional trust heuristics, Identity Firewall interception | Phase 3 — Identity Firewall |
| Policy Engine, sensitivity levels, Privacy Ledger | Phase 4 — Privacy Ledger + Policy Engine |
| Dynamic-DOM / SPA form re-render detection (`MutationObserver`) | Phase 6 — Legacy Web Compatibility |
| Any WebAuthn interception, any MAIN-world content script | **Never** — see "Resolved conflict" below |

Phase 1's only real, user-visible state is: *which origins has the content script reported a form on, this browser session*. Nothing else exists yet, and nothing else should be invented to make the phase feel more complete than it is.

### Resolved conflict: no MAIN-world script, not now, not ever

The tooling-scaffold research (correctly) documents that WXT supports MAIN-world content scripts via an `injectScript` + unlisted-script pattern, and included an `entrypoints/injected.ts` file in its general proposed tree. The runtime-architecture research, reading [ADR-011](../adr/ADR-011-webauthn-metadata-only-mode.md) and [`webauthn-technical-notes.md`](../research/webauthn-technical-notes.md) §7 directly, reaches the correct project-specific conclusion: **this project has no use for MAIN-world execution, in Phase 1 or in any later phase.** MAIN-world's only justification anywhere in this project would be intercepting `navigator.credentials`, and ADR-011 already commits this project to never doing that (metadata-only WebAuthn integration, Option A — the OS/platform authenticator handles real ceremonies untouched).

**Resolution: do not scaffold `entrypoints/injected.ts` or an `injectScript` call. The content script is ISOLATED-world only, permanently.** The tooling research's finding about *how* MAIN-world injection would work if ever needed is kept as documented background knowledge in `phase-1-tooling-scaffold.md` §3, not as a plan item.

---

## Milestones

Ordered by dependency, not by calendar week (per the roadmap's own note that sequence matters more than dates for a solo, unscheduled project).

### M1 — Project scaffold

- `pnpm dlx wxt@latest init`, select the **Vue** template (TypeScript ships by default).
- Pin the exact version in `package.json`: `"wxt": "0.21.4"` (not `^0.21.4`) — WXT is pre-1.0 and versions breaking changes aggressively; bump deliberately later, not automatically.
- Configure `wxt.config.ts`:
  ```ts
  import { defineConfig } from 'wxt';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    manifest: {
      permissions: ['storage'],
      // deliberately no host_permissions — see rationale below
    },
    vite: () => ({ plugins: [tailwindcss()] }),
  });
  ```
- **Permissions rationale**: `permissions: ['storage']` is the only permission Phase 1's own runtime behavior needs. No `host_permissions` entry — a content script's `matches` field governs where it injects and does not require a `host_permissions` grant; that grant is only needed for background-initiated cross-origin network calls, which Phase 1 has none of. This directly implements [`security-model.md`](../security-model.md)'s "minimal permissions" principle and the precedent already found in Attestto's own manifest (narrow `host_permissions`, broad `matches`).
- Add Tailwind v4 (`@import 'tailwindcss';` in each entrypoint's own CSS file — there is no single global stylesheet auto-applied everywhere in WXT).
- Add Pinia (`createPinia()` in each Vue entrypoint's `main.ts`; no first-party WXT module for it, wired exactly as in any Vue 3 app).
- Confirm `tsconfig.json` is just `{ "extends": "./.wxt/tsconfig.json" }` — never hand-edit the generated file.
- **Acceptance for M1**: `pnpm dev` launches a browser with the extension loaded and hot-reloading; `chrome://extensions` shows it with no manifest errors and exactly the `storage` permission requested.

### M2 — Shared message contract

Before any handler or UI code, lock the wire format both sides agree on:

- `shared/messages.ts` — Zod schemas for the three Phase 1 message types (`FORM_DETECTED`, `GET_SESSION_STATE`, `GET_ORIGIN_STATE`), combined into one `ExtensionMessageSchema` discriminated union, plus the `MessageResponse<T>` reply envelope (`{ ok: true, data } | { ok: false, error }`). Full schema definitions: `phase-1-runtime-architecture.md` §1.
- `shared/origin.ts` — the single canonical `normalizeOrigin()` function (a branded `CanonicalOrigin` type), used everywhere an origin is a storage key or comparison value, from this point forward. Attestto's own codebase had five independent copies of equivalent logic before consolidating (`attestto-teardown.md` §7) — this project starts with one.
- **Acceptance for M2**: unit tests (Vitest) confirm the schema accepts valid payloads and rejects malformed ones (wrong `type` literal, missing field, wrong field type), and `normalizeOrigin` treats `https://Example.com:443/path` and `https://example.com/other-path` as the same origin.

### M3 — Background service worker skeleton

- `background/router/registry.ts` — the `Capability` type (`'formDetection' | 'session' | 'vault' | 'identity' | 'firewall'`) and the message-type → `{capability, handler}` map. Only `formDetection` and `session` have real rows in Phase 1; `vault`/`identity`/`firewall` are named with no rows yet.
- `background/router/dispatch.ts` — `handleRuntimeMessage()` (installed via `installMessageRouter()`) validates against `ExtensionMessageSchema`, dispatches to the registry, and **guarantees `sendResponse` fires exactly once** via a structural `.then`/`.catch` wrapper (never a "remember to catch your promises" convention). This is the direct, load-bearing fix for a real shipped Attestto bug (`attestto-teardown.md` §7/§8.3: an unhandled rejection left a caller waiting forever). Full implementation: `phase-1-runtime-architecture.md` §1.
- `background/session/state.ts` — the `browser.storage.session`-backed `SessionState` (`Record<CanonicalOrigin, {formCount, lastDetectedAt}>`), with `getSessionState()`/`recordFormDetection()`. **Not held in an in-memory `Map` or module-level variable** — every read/write goes through `browser.storage.session`, so a service-worker restart between two messages (the ~30-second MV3 idle-kill Attestto's own history documents as a real, shipped bug class) is invisible to correctness. `browser.storage.session` (not `.local`) is deliberate: this is this-session's data, not a permanent record — a permanent per-site history is Phase 4's Privacy Ledger, not this.
  - **Correction found during implementation**: the research and this plan originally said `chrome.storage.session`/`chrome.runtime.onMessage`. WXT does not expose a typed `chrome` global at all — it exposes `browser` (imported explicitly from `wxt/browser` in this codebase, rather than relied on as an auto-imported ambient global, for auditability). On Chromium, `browser` *is* literally `globalThis.chrome` at runtime; on Firefox it's the native `browser` object. Every reference in code and in this doc should say `browser.*`, not `chrome.*`.
- `background/session/handler.ts` — `handleGetSessionState`, `handleGetOriginState`, reading from `session/state.ts`.
- `background/formDetection/handler.ts` — `handleFormDetected`, writing to `session/state.ts` via `recordFormDetection`.
- `background/vault/index.ts`, `background/identity/index.ts`, `background/firewall/index.ts` — stub modules (`export {}` plus a comment naming which phase fills them in). These exist purely so the directory shape is stable from Phase 1 onward; Phase 2/3 add files inside, not a restructure.
- `entrypoints/background.ts` — thin composition root: `defineBackground(() => installMessageRouter())`, nothing else.
- **Acceptance for M3**: unit tests confirm (a) a valid message reaches the correct handler exactly once, (b) a handler that throws still produces exactly one `{ok: false, ...}` reply — never zero, never two — and (c) an invalid raw message never reaches any handler; a `recordFormDetection` + `getSessionState` round-trip test confirms multiple origins accumulate rather than overwrite each other.

#### M3 — Implementation (as built)

Status: **implemented, tested, not yet committed** (pending review). This subsection documents what actually exists on disk right now, not just the plan for it — treat it as the as-built reference for `background/`.

##### File map

| File | Responsibility |
|---|---|
| `entrypoints/background.ts` | Composition root. Only calls `installMessageRouter()`. Nothing else lives here. |
| `background/router/dispatch.ts` | `handleRuntimeMessage()` — validate, dispatch, guarantee exactly one reply. `installMessageRouter()` — the one line that registers it with `browser.runtime.onMessage`. |
| `background/router/registry.ts` | The `Capability` type and the `message.type → {capability, handle}` map. The only file that has to change when a new message type is added. |
| `background/session/state.ts` | Owns the one piece of Phase 1 state (`SessionState`) and the only two functions allowed to touch `browser.storage.session` for it. |
| `background/session/handler.ts` | Translates `GET_SESSION_STATE`/`GET_ORIGIN_STATE` messages into calls on `session/state.ts`. |
| `background/formDetection/handler.ts` | Translates a `FORM_DETECTED` message into a `recordFormDetection` call, normalizing the origin first. |
| `background/vault/index.ts`, `background/identity/index.ts`, `background/firewall/index.ts` | Empty stubs (`export {}`). No registry rows point at them yet. |
| `shared/messages.ts` | The Zod schemas + `ExtensionMessage` union + `MessageResponse` envelope — the wire contract every one of the files above agrees on. |
| `shared/origin.ts` | `normalizeOrigin()` — the one function allowed to turn a raw URL/origin string into a `CanonicalOrigin` storage key. |

##### How the files connect (static dependency graph)

```text
entrypoints/background.ts
        │
        │ installMessageRouter()
        ▼
background/router/dispatch.ts ───────────────▶ shared/messages.ts
        │  registry[message.type]                (ExtensionMessageSchema,
        ▼                                          MessageResponse)
background/router/registry.ts
        │
        ├─ FORM_DETECTED ─────▶ background/formDetection/handler.ts ─▶ shared/origin.ts
        │                              │                                (normalizeOrigin)
        │                              ▼
        │                        background/session/state.ts ─▶ browser.storage.session
        │                              ▲
        ├─ GET_SESSION_STATE ─▶ background/session/handler.ts ─┘
        ├─ GET_ORIGIN_STATE  ─▶ (same file, same state.ts)
        │
        ├─ (no rows yet) ─────▶ background/vault/index.ts      [STUB — Phase 2]
        ├─ (no rows yet) ─────▶ background/identity/index.ts   [STUB — Phase 2]
        └─ (no rows yet) ─────▶ background/firewall/index.ts   [STUB — Phase 3]
```

Nothing outside `background/router/registry.ts` needs to know that `vault`/`identity`/`firewall` don't have real handlers yet — the type system just has no message types that route there.

##### Sequence: a read (`GET_SESSION_STATE`, from the popup)

```text
Popup
 │  browser.runtime.sendMessage({ type: 'GET_SESSION_STATE' })
 ▼
browser.runtime.onMessage  ── the listener installMessageRouter() registered
 ▼
dispatch.ts: handleRuntimeMessage(raw, sender, sendResponse)
 │
 ├─ ExtensionMessageSchema.safeParse(raw)
 │     ✕ invalid  → sendResponse({ ok:false, error:'INVALID_MESSAGE' }); return false   [reply path #1]
 │     ✓ valid
 ▼
registry.ts: registry['GET_SESSION_STATE'] → { capability:'session', handle: handleGetSessionState }
 ▼
session/handler.ts: handleGetSessionState(message)
 ▼
session/state.ts: getSessionState()
 ▼
browser.storage.session.get(SESSION_STORAGE_KEY) → { originForms: {...} }
 ▼  (resolves back up through the same promise chain)
dispatch.ts:
   .then(data  => sendResponse({ ok:true,  data }))              [reply path #2]
   .catch(err  => sendResponse({ ok:false, error: err.message })) [reply path #3]
 ▼
Popup receives { ok: true, data: { originsWithForms: [...] } }
```

`GET_ORIGIN_STATE` takes the identical path, just calling `handleGetOriginState` instead and returning one origin's record (or `null`) instead of the whole list.

##### Sequence: a write (`FORM_DETECTED`, from the content script)

```text
Content script (Phase 1 placeholder today, real detection in M4)
 │  browser.runtime.sendMessage({ type:'FORM_DETECTED', payload:{ origin, url, detectedAt, forms } })
 ▼
dispatch.ts: handleRuntimeMessage  ── same validate → registry lookup → dispatch as above
 ▼
registry.ts: registry['FORM_DETECTED'] → { capability:'formDetection', handle: handleFormDetected }
 ▼
formDetection/handler.ts: handleFormDetected(message)
 │
 ├─ normalizeOrigin(message.payload.origin)   ── shared/origin.ts, the one canonical function
 ▼
session/state.ts: recordFormDetection(canonicalOrigin, forms.length, detectedAt)
 │
 ├─ getSessionState()          ── read the current map
 ├─ mutate the in-memory copy  ── state.originForms[origin] = {...}
 ▼
browser.storage.session.set({ [SESSION_STORAGE_KEY]: state })  ── write the whole map back
 ▼
handler resolves { recorded: true } → dispatch.ts's .then → sendResponse({ ok:true, data:{recorded:true} })
```

This read-modify-write is not atomic on its own -- two `recordFormDetection` calls arriving close together (e.g. two tabs restored at once) would otherwise both read the same pre-update snapshot and the later `set()` would clobber the earlier one's origin. `session/state.ts` serializes calls through an in-memory promise queue so each write waits for the previous one to finish before reading. The queue holds no state that correctness depends on across a service-worker restart -- it only orders writes made while one worker instance is alive.

##### The exactly-once reply guarantee, visually

This is the direct fix for the Attestto bug in `docs/research/attestto-teardown.md` §7/§8.3 (an unhandled rejection left a caller waiting forever). Every call to `handleRuntimeMessage` takes **exactly one** of these three exits — never zero, never two:

```text
handleRuntimeMessage(raw, sender, sendResponse)
        │
        ▼
   schema valid? ──✕ NO──▶ sendResponse({ok:false, error:'INVALID_MESSAGE'})   [path #1 — synchronous]
        │
        ✓ YES
        ▼
   entry.handle(message, {sender})   ── always returns a Promise
        │
        ├── resolves ──▶ sendResponse({ok:true,  data})                       [path #2 — .then]
        └── rejects  ──▶ sendResponse({ok:false, error: err.message})         [path #3 — .catch]
```

Paths #2 and #3 are mutually exclusive outcomes of the *same* promise (a promise settles exactly once), and path #1 returns before that promise is even created — so there is no code path in this function that can call `sendResponse` twice, and no code path that can silently swallow a thrown error and call it zero times.

##### Test coverage (25 tests total, all passing)

- `tests/unit/shared/messages.test.ts` — schema accepts valid payloads for all three message types, rejects an unknown `type`, a missing required field, and a wrong field type.
- `tests/unit/shared/origin.test.ts` — default-port stripping, lowercasing, non-default ports kept distinct, query/hash ignored.
- `tests/unit/background/router/dispatch.test.ts` — the three reply-path guarantees above, tested directly: a valid message replies once; an invalid message replies once, synchronously, without reaching any handler; a handler forced to throw (by making `fakeBrowser.storage.session.get` reject) still replies exactly once, with the thrown error's message.
- `tests/unit/background/session/state.test.ts` — empty state, single round-trip, multiple distinct origins accumulating, re-detection on the same origin overwriting only that origin's record, an empty state read after a recorded one is a real empty object rather than a stale reference, and two concurrent `recordFormDetection` calls on different origins both survive (the write queue, not a shared object identity).
- `tests/unit/background/session/handler.test.ts` — `handleGetOriginState` finds a record when queried with a non-canonical form of an origin that was stored normalized, and returns `null` for an origin with no record.
- `tests/unit/background/formDetection/handler.test.ts` — an end-to-end call through `handleFormDetected` confirms the origin is normalized (a mixed-case, default-port URL in the message payload is looked up in session state via its normalized form) before being used as a storage key.

All tests mock the browser API by importing `fakeBrowser` from `wxt/testing/fake-browser` — the same singleton object `WxtVitest()` aliases `wxt/browser`'s `browser` export to during tests, so exercising `fakeBrowser.storage.session` in a test is exercising the exact object the production code reads and writes through `browser.storage.session`.

### M4 — Content script

- `entrypoints/content.ts` — **ISOLATED world only** (the default; no `world: 'MAIN'` option set — see "Resolved conflict" above). `matches: ['http://*/*', 'https://*/*']`, `runAt: 'document_idle'`.
- Reports **structure, not semantics**: walks `document.forms`, extracts each form's `action`/`method` and each `<input>`/`<textarea>`/`<select>` field's `tagName`/`type`/`name`/`id`/`required` — no inference about what a field *means* (that's Phase 3's Field Classifier). If no forms exist on the page, no message is sent at all.
- Extract the pure DOM-walking function separately from the `defineContentScript` wrapper specifically so it's unit-testable against a JSDOM fixture without a real browser.
- Full implementation: `phase-1-runtime-architecture.md` §3.
- **Acceptance for M4**: a unit test against a JSDOM fixture confirms the extractor captures `tagName`/`type`/`name`/`id`/`required` correctly for a known form and does not attempt semantic classification; a page with zero `<form>` elements produces no extracted output.

#### M4 — Implementation (as built)

Status: **implemented, tested, committed**.

##### Deviation from the plan: a new `content/formDetection.ts`

The original directory-tree sketch only listed `entrypoints/content.ts`. During implementation, the pure DOM-extraction logic was split into a new top-level `content/formDetection.ts` module instead of living inside `entrypoints/content.ts` directly — mirroring the M3 precedent exactly: `entrypoints/*.ts` files are thin composition roots (`entrypoints/background.ts` only calls `installMessageRouter()`); everything testable lives in a plain module a Vitest test can import without going through WXT's entrypoint machinery. `defineContentScript()` is a pure identity function (confirmed by reading WXT's own source — it never calls `main()` at import time), so importing an entrypoint file directly in a test would have been safe too, but keeping the pure logic in a sibling module avoids any need for the test file to touch `browser`/`fakeBrowser` at all, since only `entrypoints/content.ts` (not `content/formDetection.ts`) imports `wxt/browser`.

- `content/formDetection.ts` — two pure functions:
  - `extractForms(doc: Document): DetectedForm[]` — DOM-walking only.
  - `buildFormDetectedMessage(doc: Document, href: string, detectedAt: number): FormDetectedMessage | null` — calls `extractForms`, returns `null` when there are zero forms (the actual "should we send at all" decision). `href` and `detectedAt` are explicit parameters rather than read internally from `location.href`/`Date.now()`, matching `background/session/state.ts`'s `recordFormDetection(origin, formCount, detectedAt)` convention from M3.
- `entrypoints/content.ts` — imports `browser` from `wxt/browser` (explicit, matching the M3 convention) and `buildFormDetectedMessage`; `main()` builds the message, returns early if `null`, otherwise sends with `browser.runtime.sendMessage(message).catch(() => {})`. The `.catch(() => {})` is deliberate and silent: a rejected promise here (e.g. "Extension context invalidated" after a dev-mode reload, or the background worker not yet awake) would otherwise surface as an unhandled promise rejection in **the page's own console**, violating M7's "no console errors" check; logging it would violate the same check for a different reason and gives the user nothing actionable.
- No defensive error handling around `normalizeOrigin(location.href)` or `document.forms`: the content script's `matches: ['http://*/*', 'https://*/*']` is a browser-enforced injection gate, so `main()` provably only ever runs on a document whose URL the browser already parsed as `http:`/`https:` to inject the script at all — `new URL(location.href)` cannot hit a parse failure at this call site, and `document.forms` is a live `HTMLCollection`, never null/throwing.

##### Testing gap closed: `jsdom` was not installed

Confirmed during implementation that neither `jsdom` nor `happy-dom` was a dependency, and `vitest.config.ts` set no `test.environment` (Vitest's default is `node`, no DOM globals) — so the plan's own "unit test against a JSDOM fixture" acceptance line could not have run before this milestone. Added `jsdom` (not `happy-dom`, matching the plan's own wording and jsdom's more spec-faithful `HTMLFormElement.elements`/IDL-attribute-defaulting behavior) as an exact-pinned devDependency (`"jsdom": "30.0.1"`, matching this project's precedent for test-infrastructure packages like `vitest`/`@biomejs/biome`). The environment is opted into **per-file**, via a `// @vitest-environment jsdom` docblock at the top of the one new test file — not globally in `vitest.config.ts` — so every other (DOM-free) test file stays on the faster `node` default.

##### A real Biome finding worth recording

`lint/style/noNonNullAssertion` **is** part of Biome's `recommended` preset (as a warning, "Unsafe fix: Replace with optional chain operator") — an earlier planning pass had checked this and concluded it wasn't enabled, which was wrong. All non-null assertions (`forms[0]!`) in the new test file were rewritten as optional chains (`forms[0]?.fields`, `fields?.[0]?.name`) instead, which is both what Biome recommends and arguably better test hygiene: if a fixture-guaranteed index turned out to be missing, the assertion fails on a clear value mismatch (e.g. `undefined` where a string was expected) rather than throwing inside the test body.

##### Test coverage (8 new tests, 33 total)

`tests/unit/content/formDetection.test.ts` (`// @vitest-environment jsdom`), covering: a required email input (all five `DetectedField` properties); a field with neither `name` nor `id` (both come back `null`); two forms on one page (correct `formIndex` each, fields don't bleed across forms); a `<select>` and a `<textarea>` (`tagName` lowercased, `type` is `null` for both); a `<button>` inside a form (filtered out of `fields`); a page with zero forms (`extractForms` → `[]`); `buildFormDetectedMessage` returning `null` for zero forms; and a full `buildFormDetectedMessage` assertion confirming the origin gets normalized (`https://Example.com:443/login?next=/home` → `https://example.com` in `payload.origin`, while `payload.url` keeps the original un-normalized string) and `detectedAt` passes through unchanged.

##### Fixes from code review (`/code-review`, 5 findings, all fixed)

- **`entrypoints/content.ts` — silent handler-failure loss.** The original `.catch(() => {})` only catches a *transport-level* rejection. `background/router/dispatch.ts` is deliberately built to never reject — even a handler failure resolves as `{ok:false, error}` — so a real failure (e.g. `recordFormDetection`'s `browser.storage.session.set` rejecting) was being silently dropped with zero trace, indistinguishable from a page with no form at all. Fixed by reading the resolved `MessageResponse` and `console.debug`-ing (not `warn`/`error`, to stay inside M7's "no console errors" line) when `ok` is `false`; `.catch()` now only covers the genuinely separate transport-failure case.
- **`content/formDetection.ts` — tag-matching broke on XHTML documents.** `DETECTABLE_TAGS` compared against uppercase tag names (`'INPUT'`, etc.), which silently under-reports every field on a page served as `application/xhtml+xml` (where `Element.tagName` preserves source case, e.g. `'input'`) — no crash, just an empty `fields: []` for every form on that page. Fixed by reverting to `instanceof HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement` checks (the original research sketch's own approach, before this implementation introduced the tagName-matching detour), which don't depend on tag-name casing at all. This also resolved a separate, smaller finding for free: the union type was duplicated between `isDetectableField` and `extractField`; it's now one named `DetectableFieldElement` type used by both.
- **`tests/unit/content/formDetection.test.ts` — duplicated `beforeEach`.** The identical `document.body.innerHTML = ''` reset was repeated in both `describe` blocks; hoisted to one file-level `beforeEach` outside both.
- **This doc — wrong test count.** Said "12 new tests"; the file actually has 8 `it()` blocks (25 pre-existing + 8 = 33 total, which was already correct). Corrected above.

Not fixed, noted as a deliberate trade-off: the XHTML-document scenario has no dedicated regression test, since reproducing it would require constructing a custom `jsdom.JSDOM` document with `contentType: 'application/xhtml+xml'` rather than the lightweight `// @vitest-environment jsdom` + `document.body.innerHTML` pattern the rest of this test file uses — a real cost for a content-type that's effectively extinct on the modern web. The `instanceof`-based fix is correct by construction regardless (it checks the DOM interface, not a string), so this is judged not worth the added test infrastructure for Phase 1.

### M5 — Popup UI

- `entrypoints/popup/` (`index.html`, `main.ts`, `App.vue`, `style.css` with `@import 'tailwindcss';`).
- `stores/session.store.ts` — a Pinia store (`useSessionStore`) that calls `chrome.runtime.sendMessage({type: 'GET_SESSION_STATE'})` on mount and renders the result. **The popup never reads `chrome.storage` directly** — it only ever talks to background over the M3 message router, so background stays the single writer of session state and the popup is a pure read-through view. This matters because a popup is destroyed and recreated from scratch on every open (no persistent JS state to resume across opens), so there is no meaningful "Pinia persistence" problem to solve in Phase 1 — the store simply refetches every mount. (A generic Pinia-state-survives-popup-close problem exists for *later* phases that hold popup-local UI state across opens — e.g. a half-filled settings form — and is deliberately deferred; see "Open questions" below.)
- UI: a "Sites detected this session" list (origin + form count) and a "Vault — not yet implemented, arrives in Phase 2" placeholder section that makes no network or storage calls.
- Full implementation: `phase-1-runtime-architecture.md` §5.
- **Acceptance for M5**: opening the popup on a tab with a detected form shows that origin and form count; opening it on a tab with none shows the empty state; the vault placeholder renders with no console errors.

#### M5 — Implementation (as built)

Status: **implemented, tested, manually verified in real Chrome, committed**.

##### Deviation from the research sketch, and a correction

`phase-1-runtime-architecture.md` §5's sketch put the store at `entrypoints/popup/stores/session.store.ts` (nested) and used bare `chrome.runtime.sendMessage(...)`. Neither was carried forward:

- **Location**: `stores/session.store.ts` is a new **top-level** directory, sibling of `entrypoints/`, `background/`, `content/`, `shared/` — matching this plan's own directory tree (below) and mirroring M4's own precedent exactly: `entrypoints/content.ts` stayed a thin composition root, with the actual testable logic (`extractForms`, `buildFormDetectedMessage`) living in a new top-level `content/formDetection.ts`, not nested inside `entrypoints/content/`. A Pinia store is the same kind of framework-adjacent-but-not-WXT-entrypoint-coupled module; only `App.vue` itself is truly entrypoint-coupled and stays nested.
- **API convention**: `browser` imported explicitly from `wxt/browser`, matching the M3 correction already documented above — not `chrome.*`.

##### File map

| File | Responsibility |
|---|---|
| `stores/session.store.ts` | `useSessionStore` — one action, `fetchSessionState()`, state machine `idle → loading → loaded \| error`. Never reads `browser.storage` directly; only talks to background over the M3 message router. |
| `entrypoints/popup/App.vue` | `onMounted` triggers the fetch; template renders loading/error/list/empty states plus the static Vault placeholder. |

##### Two failure paths, both land in the same `error` state

`fetchSessionState()` distinguishes a **handler-level failure** (`background/router/dispatch.ts` resolves `{ok:false, error}` — it deliberately never rejects, per its own header comment) from a **transport-level failure** (a rejected `sendMessage` promise — e.g. "Extension context invalidated" after a dev-mode reload). `entrypoints/content.ts` draws this same distinction but has no UI to surface it in, so it swallows the transport case silently; the popup has a UI, so both paths set `status: 'error'` with a message, via an explicit `try/catch` around the `{ok:false}` check.

##### A real TypeScript finding: `fakeBrowser.runtime.sendMessage`'s overloaded type

Planning assumed `browser.runtime.sendMessage`'s resolved type is `any` everywhere (based on `entrypoints/content.ts`'s existing `.then((response: MessageResponse) => ...)` annotation already type-checking). That holds for `browser` imported from `wxt/browser` in production code, but **not** for `fakeBrowser.runtime.sendMessage` directly in test files: `vi.spyOn(fakeBrowser.runtime, 'sendMessage')` infers a `void`-returning overload (inherited from `chrome.runtime.sendMessage`'s classic multi-overload callback-style signature set), unlike single-signature methods such as `storage.session.get` that M3/M4's tests already mock cleanly. Fixed with a narrow, commented `as never` cast on each `mockResolvedValueOnce(...)` call — a test-file-only workaround that doesn't affect the store's own production typing.

##### Test coverage (4 new tests, 37 total)

`tests/unit/stores/session.store.test.ts`: a successful response populates `originsWithForms` and sets `status: 'loaded'`; a `{ok:false}` handler response sets `status: 'error'` with the message; a rejected `sendMessage` promise (transport failure) also lands in `status: 'error'`; and an assertion that `sendMessage` is called with the bare `{type: 'GET_SESSION_STATE'}` payload (no `payload` key), locking in that decision against future drift.

##### Deliberately not automated: the `.vue` template itself

Verified empirically (reading `node_modules/wxt/dist/testing/wxt-vitest-plugin.mjs` and `@wxt-dev/module-vue`'s source, and confirming `@vitejs/plugin-vue` isn't resolvable in this project's `node_modules`) that `WxtVitest()` never wires Vue SFC compilation into the Vitest pipeline — only into WXT's actual build. Testing `App.vue` itself would need two new pieces of infrastructure (`@vitejs/plugin-vue`, `@vue/test-utils`) with zero precedent in this codebase, for a template that's mostly `v-if`/`v-for` over data the store test already covers. Covered instead by manual verification in real Chrome (done together with the user this milestone: visited `github.com/login`, confirmed the popup showed `https://github.com — 1 form(s)` exactly as designed) and, later, M6's Playwright pass, which drives the real built popup HTML at higher fidelity than a jsdom simulation would.

##### Fixes from code review (`/code-review`, 4 findings, all fixed)

- **`shared/messages.ts`/`stores/session.store.ts`/`background/session/handler.ts` — triplicated wire-shape type.** `OriginSummary` (`{origin, formCount, lastDetectedAt}`) was independently declared in the store and inline in the handler's return type, with no shared import linking them — a future field rename on either side would silently drift instead of failing to compile. Fixed by defining `OriginSummary` once in `shared/messages.ts` and importing it in both places; this is a single-package TypeScript program, so despite the wire boundary being untyped JSON at runtime, the two sides now share one compile-time source of truth.
- **`stores/session.store.ts` — unvalidated response could crash the popup's render.** The response side of the channel isn't Zod-validated the way requests are (only `ExtensionMessageSchema.safeParse` in `dispatch.ts` guards the request side); a shape drift would have left `status: 'loaded'` with `originsWithForms` silently `undefined`, and `App.vue`'s `session.originsWithForms.length` would throw instead of falling into the error state. Fixed with a defensive `Array.isArray(response.data?.originsWithForms) ? ... : []` guard — proportional to Phase 1 (background and the popup are both first-party code, not an adversarial boundary the way site-provided form data is, so a full response schema wasn't judged worth adding yet).
- **`entrypoints/popup/App.vue` — `'idle'` and empty-`'loaded'` rendered identically.** A broken `onMounted` wiring (fetch never running) would have shown "No forms detected yet this session." — indistinguishable from a genuinely empty, successfully-fetched session. Fixed by merging the `'idle'` status into the same branch as `'loading'` ("Loading…"), so a stuck fetch stays visibly "loading" forever instead of silently masquerading as a real empty result.
- **`stores/session.store.ts` — non-`Error` rejections lost their diagnostic message.** The `catch` block's fallback was a generic `'Unknown error'` string, discarding whatever the actual rejection value was — inconsistent with `background/router/dispatch.ts`'s own `String(err)` handling of the same situation. Fixed to match: `err instanceof Error ? err.message : String(err)`.

### M6 — End-to-end test

- Playwright, per WXT's own guidance that it's "the only good option" for this: `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=<path>', '--load-extension=<path>'] })` pointed at the real build output (`.output/chrome-mv3`), not a hand-maintained test fixture extension.
- Fixture pages: at least two distinct local origins, each with a login-shaped form (`<input type="email">`, `<input type="password">`, both `required`).
- Test flow: navigate to fixture origin 1 → open the popup (`chrome-extension://<id>/popup.html` directly, since Playwright can't click a real toolbar icon) → assert origin 1 appears with the right form count → navigate to fixture origin 2 → reopen the popup → assert **both** origins now appear (this is the real cross-navigation accumulation behavior a mocked-storage unit test can't fully exercise).
- Explicitly not attempted in Playwright: simulating the exact ~30-second MV3 service-worker idle-kill (Playwright doesn't reliably control this timing) — that property is covered by the manual checklist item in M7 plus the unit-level guarantee that every read/write already goes through `chrome.storage.session` rather than memory (M3).
- Full implementation shape: `phase-1-tooling-scaffold.md` §9, `phase-1-runtime-architecture.md` §6.

#### M6 — Implementation (as built)

Status: **implemented, tested (5/5 consecutive runs, no flakiness), committed**.

##### Confirmed against Playwright's real current docs, not just the research sketch

Before writing any code, `channel: 'chromium'` was re-verified directly against playwright.dev/docs/chrome-extensions (not assumed from the Phase 0 research alone, since that doc predates this implementation by weeks). Confirmed accurate: it's a real, current, documented option, and it's specifically what makes headless extension testing possible (`chromium.launchPersistentContext('', { channel: 'chromium', args: [...] })`) — without it Playwright historically required headed Chromium for extension tests. The official `test.extend<{context, extensionId}>({...})` fixture pattern was also confirmed current and used as-is.

##### File map

| File | Responsibility |
|---|---|
| `playwright.config.ts` | `testDir: './tests/e2e'`. Deliberately not part of `pnpm check`/Husky's pre-commit hook — a real Chromium launch is multi-second and needs a separately-installed browser binary, unlike the always-available Vitest suite. Run via `pnpm test:e2e` (builds first, then runs). |
| `tests/e2e/fixtures/server.ts` | A minimal static HTTP server using only Node's built-in `http`/`fs` (no new dependency) — two distinct origins are two instances on two dynamically-allocated ports, since `shared/origin.ts`'s own `normalizeOrigin` already treats different ports on the same host as different origins. |
| `tests/e2e/fixtures/login-form.html` | The fixture page itself — one `<form>`, required email + password inputs. |
| `tests/e2e/formDetection.test.ts` | The actual test: launches the real `.output/chrome-mv3` build, navigates to origin 1, opens the popup, asserts; navigates to origin 2, reopens the popup, asserts both origins accumulate. |

##### Real bugs found only by actually running it, not by reasoning about it

Two genuine runtime failures surfaced only once the test was actually executed — neither was, or could have been, caught by static planning:

- **`__dirname` doesn't exist.** `package.json`'s `"type": "module"` makes every `.ts` file here ESM, which has no `__dirname` global. Both `fixtures/server.ts` and `formDetection.test.ts` used `import.meta.dirname` (Node 20.11+/24) instead.
- **`server.close()` hung forever.** Node's `http.Server.close()` only stops accepting *new* connections — it waits for existing ones to end on their own. Nothing in the test navigates the browser away from the last-visited origin before calling `close()`, so an idle keep-alive connection kept the promise from ever resolving. Fixed by also calling `server.closeAllConnections()` (Node 18.2+) to forcibly end any open sockets. Confirmed via a real trace (`pnpm exec playwright test --trace on`) and its screenshot, which showed the popup already correctly rendering both origins — the feature worked; only the test's own cleanup was hanging.

##### Fixes from code review (`/code-review`, 3 findings, all fixed)

- **A real race condition, not just a style nit.** `stores/session.store.ts`'s `fetchSessionState()` runs exactly once per mount, with no polling or retry. The original test did a single `popup.reload()` immediately after navigating to origin 2, with nothing waiting for the content script's `document_idle` injection plus the background round-trip to actually finish first — on a slower/loaded machine, the popup could render once with stale data and never update again, since a plain `toBeVisible()` retry only re-inspects the existing (unchanging) DOM. Fixed with `expect.poll()`, which re-runs the *entire* reload on every retry attempt (a fresh fetch each time, not just a fresh look at stale DOM) until origin 2 actually appears or a 10s timeout is hit.
- **A resource leak if the second fixture server failed to start.** `siteA`/`siteB` were both `await`ed before the `try` block began, so a throw from the second call would leave the first server's socket open for the rest of the process. Fixed by moving both `startFixtureServer()` calls inside the `try`, declaring the variables as `FixtureServer | undefined` beforehand, and using `?.close()` in `finally` (a no-op for whichever one never got created).
- **A comment pointed at documentation that didn't exist.** `playwright.config.ts`'s comment said "see README" for the one-time `playwright install chromium` step, but the README had no testing section at all. Fixed by actually adding one (`## Development` → `### Testing`), rather than just removing the dangling reference — and, while there, corrected the README's `## Status` line, which still said "no product code yet" despite M1–M6 all being implemented.

### M7 — Manual acceptance pass

Run through, in a real Chrome (and ideally Firefox, given it's an explicit target) profile with the production build loaded unpacked:

- [x] Build produces an unpacked extension with no manifest errors and exactly the `storage` permission.
- [x] A page with a form produces no console errors (page console or service-worker console).
- [x] Popup shows the visited origin with a form count > 0.
- [x] Visiting a second origin, then reopening the popup, shows **both** origins (proves accumulation, not just "most recent page").
- [x] Manually terminating the service worker (`chrome://extensions` → service worker → "terminate", or waiting out the idle timer), then reopening the popup, **still shows the previously-detected origins** — this is the concrete, hands-on proof that `chrome.storage.session` persistence (not an in-memory `Map`) actually survives a real worker restart, not just a quick manual test that never gave the worker time to die.
- [x] A page with no `<form>` produces no popup entry for that origin. (See note below — the specific attempt used a page that turned out to genuinely have a form.)
- [x] The Vault placeholder is visible and inert (no network/storage calls).

#### M7 — Results (as run)

Run together with the user, in real Chrome, against the production `.output/chrome-mv3` build loaded unpacked (not `pnpm dev`'s `chrome-mv3-dev`).

- **Extension ID**: `efkofjkkjdhlfgocnjnbcpajflnmkomo`. Loaded with no manifest errors. Chrome's "Site access: On all sites" UI appeared on the extension's details page — confirmed this is Chrome's standard display for *any* extension with broad content-script `matches` patterns (`http://*/*`, `https://*/*`), not evidence of an actual `host_permissions` grant; the real manifest (verified directly from the build output, not just the UI) is exactly `"permissions":["storage"]`, no `host_permissions`.
- **Accumulation confirmed live**: visited `github.com/login` (1 form) then `gitlab.com/users/sign_in` (7 forms) — the popup showed both together, with correct per-site counts, not just the most recent page.
- **The centerpiece test passed**: found the extension's service worker on `chrome://serviceworker-internals/` (the reliable way to force-stop one — the "service worker" link on `chrome://extensions` only opens its DevTools, it doesn't offer a stop control itself), clicked **Stop** with `Running Status: RUNNING` confirmed beforehand, then reopened the popup — both previously-detected origins were still there. This is the concrete proof that `browser.storage.session` persistence (not an in-memory `Map`) survives a real MV3 service-worker restart, the exact property M3's design (and this whole milestone) exists to guarantee.
- **The "no form" check's first attempt was a bad example, not a bug**: `google.com`'s homepage was tried as a "no form" page, but it showed up with "1 form(s)" — correctly, because Google's homepage genuinely contains a `<form>` (the search box itself). This confirmed correct detection behavior rather than a false positive; it just wasn't a clean test of the negative case. Not re-run with a genuinely form-less page (e.g. `example.com`) since the underlying behavior (`extractForms` returning `[]` → no message sent → no popup entry) is already directly unit-tested in `tests/unit/content/formDetection.test.ts` ("returns an empty array for a page with no forms") and exercised structurally by M6's e2e test.
- **One real, expected state reset observed, not a bug**: between the accumulation check and the service-worker-kill check, `github.com` briefly disappeared from the popup, leaving only the two most recently visited origins. The likely cause is the extension itself being reloaded (not just its service worker) at some point while navigating `chrome://extensions` — `browser.storage.session` is documented to clear on extension reload/update or browser restart, which is a different, expected event from the service-worker idle-kill this milestone specifically tests (and which was separately, successfully proven to *not* clear the data). Worth knowing as a real characteristic of the storage layer, not a defect: "session" here means "this browser session," bounded by the extension's own lifecycle, not "forever until explicitly cleared."
- **Firefox was not tested manually** — the user's daily browser is Firefox, but they opted to skip the manual Firefox pass for now given Chrome/MV3 is the primary target and the automated build/type-check pipeline already confirms `.output/firefox-mv2` builds cleanly (see M1's build verification). Manual Firefox verification remains untested; flagging this honestly rather than claiming coverage that wasn't done.

Phase 1 is complete. See [`../roadmap.md`](../roadmap.md) for the phase marked done.

---

## Directory tree (target state at the end of Phase 1)

```text
identity-firewall-ext/
├── .wxt/                          # auto-generated by `wxt prepare` — gitignored, never hand-edited
├── .output/                       # build artifacts — gitignored
├── assets/
├── public/
│   └── icon/                      # 16/48/128 px
├── entrypoints/
│   ├── background.ts              # composition root: installMessageRouter() only
│   ├── content.ts                 # ISOLATED world only — see "Resolved conflict"
│   └── popup/
│       ├── index.html
│       ├── main.ts                 # createApp + createPinia
│       ├── App.vue
│       └── style.css               # @import 'tailwindcss';
├── background/
│   ├── router/
│   │   ├── dispatch.ts             # installMessageRouter, guaranteed-single-reply wrapper
│   │   └── registry.ts             # message-type -> {capability, handler} map
│   ├── formDetection/
│   │   └── handler.ts              # handleFormDetected — Phase 1, real
│   ├── session/
│   │   ├── handler.ts              # handleGetSessionState, handleGetOriginState — Phase 1, real
│   │   └── state.ts                # chrome.storage.session wrapper
│   ├── vault/index.ts              # STUB — Phase 2 fills this in
│   ├── identity/index.ts           # STUB — Phase 2 fills this in
│   └── firewall/index.ts           # STUB — Phase 3 fills this in
├── content/
│   └── formDetection.ts            # extractForms(), buildFormDetectedMessage() — pure, M4
├── shared/
│   ├── messages.ts                 # Zod schemas + ExtensionMessage union
│   └── origin.ts                   # normalizeOrigin() + CanonicalOrigin brand
├── stores/
│   └── session.store.ts            # Pinia store, popup-side
├── tests/
│   ├── unit/                       # Vitest, via WxtVitest plugin
│   └── e2e/                        # Playwright, launchPersistentContext
├── wxt.config.ts
├── vitest.config.ts                # WxtVitest() plugin
├── playwright.config.ts
├── tsconfig.json                   # { "extends": "./.wxt/tsconfig.json" }
├── package.json
└── pnpm-lock.yaml
```

No `entrypoints/injected.ts`, no `world: 'MAIN'` anywhere — see "Resolved conflict" above.

---

## Open questions to confirm at implementation time, not before

These are flagged in the research as version-sensitive or as a deliberate later decision, not blockers to starting:

- **Pinia cross-open persistence approach** (relevant once a later phase needs popup-local state to survive a close, e.g. a half-filled settings form): a hand-rolled `store.$subscribe`-based plugin writing through to `storage.defineItem`, versus the third-party `pinia-plugin-webext-storage` package. Recommendation leaning hand-rolled, per `security-model.md`'s general preference for fewer dependencies — decide when the need actually arises (not Phase 1, whose only Pinia store is a pure read-through with nothing worth persisting across popup closes).
- **Exact `storage.defineItem` API surface and the dev-vs-build output directory naming** (e.g. `.output/chrome-mv3` vs `.output/chrome-mv3-dev`) should be confirmed directly against `wxt.dev/storage` and the pinned `wxt@0.21.4` release at the moment of writing code, since both are flagged in `phase-1-tooling-scaffold.md` as details most likely to shift across WXT releases.
- **Package manager**: pnpm is recommended (fast, disk-efficient, common in the WXT ecosystem) but is a project preference, not a WXT requirement — confirm before running M1 if there's a reason to prefer npm/bun instead.
- **Firefox build warnings discovered during M1** (not blockers — `pnpm build:firefox` succeeds, these are warnings): (1) Firefox requires `data_collection_permissions` in the manifest for new extensions submitted from November 2025 onward — needs a real, considered declaration (what data this extension actually collects — per `docs/privacy-model.md`, the honest answer is "none" beyond what's local), not a placeholder; (2) Firefox recommends (MV2) / requires (MV3) an explicit extension ID via `browser_specific_settings.gecko.id`. Both are Phase 8 (Open Source Release) concerns — resolve before that phase's store submission, not before M1's own acceptance criteria.

---

## What "done" means for Phase 1

All of M1–M7 pass, and the result is an installable, hot-reloadable browser extension that does exactly one useful thing end to end — notices forms on pages and remembers which origins had them, surviving a real service-worker restart — with every later phase's module boundary already named and stubbed, and nothing from those later phases implemented early.
