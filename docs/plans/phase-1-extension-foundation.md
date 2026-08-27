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
- `background/router/dispatch.ts` — `installMessageRouter()`, the single `chrome.runtime.onMessage` listener that validates against `ExtensionMessageSchema`, dispatches to the registry, and **guarantees `sendResponse` fires exactly once** via a structural `.then`/`.catch` wrapper (never a "remember to catch your promises" convention). This is the direct, load-bearing fix for a real shipped Attestto bug (`attestto-teardown.md` §7/§8.3: an unhandled rejection left a caller waiting forever). Full implementation: `phase-1-runtime-architecture.md` §1.
- `background/session/state.ts` — the `chrome.storage.session`-backed `SessionState` (`Record<CanonicalOrigin, {formCount, lastDetectedAt}>`), with `getSessionState()`/`recordFormDetection()`. **Not held in an in-memory `Map` or module-level variable** — every read/write goes through `chrome.storage.session`, so a service-worker restart between two messages (the ~30-second MV3 idle-kill Attestto's own history documents as a real, shipped bug class) is invisible to correctness. `chrome.storage.session` (not `.local`) is deliberate: this is this-session's data, not a permanent record — a permanent per-site history is Phase 4's Privacy Ledger, not this.
- `background/session/handler.ts` — `handleGetSessionState`, `handleGetOriginState`, reading from `session/state.ts`.
- `background/formDetection/handler.ts` — `handleFormDetected`, writing to `session/state.ts` via `recordFormDetection`.
- `background/vault/index.ts`, `background/identity/index.ts`, `background/firewall/index.ts` — stub modules (`export {}` plus a comment naming which phase fills them in). These exist purely so the directory shape is stable from Phase 1 onward; Phase 2/3 add files inside, not a restructure.
- `entrypoints/background.ts` — thin composition root: `defineBackground(() => installMessageRouter())`, nothing else.
- **Acceptance for M3**: unit tests confirm (a) a valid message reaches the correct handler exactly once, (b) a handler that throws still produces exactly one `{ok: false, ...}` reply — never zero, never two — and (c) an invalid raw message never reaches any handler; a `recordFormDetection` + `getSessionState` round-trip test confirms multiple origins accumulate rather than overwrite each other.

### M4 — Content script

- `entrypoints/content.ts` — **ISOLATED world only** (the default; no `world: 'MAIN'` option set — see "Resolved conflict" above). `matches: ['http://*/*', 'https://*/*']`, `runAt: 'document_idle'`.
- Reports **structure, not semantics**: walks `document.forms`, extracts each form's `action`/`method` and each `<input>`/`<textarea>`/`<select>` field's `tagName`/`type`/`name`/`id`/`required` — no inference about what a field *means* (that's Phase 3's Field Classifier). If no forms exist on the page, no message is sent at all.
- Extract the pure DOM-walking function separately from the `defineContentScript` wrapper specifically so it's unit-testable against a JSDOM fixture without a real browser.
- Full implementation: `phase-1-runtime-architecture.md` §3.
- **Acceptance for M4**: a unit test against a JSDOM fixture confirms the extractor captures `tagName`/`type`/`name`/`id`/`required` correctly for a known form and does not attempt semantic classification; a page with zero `<form>` elements produces no extracted output.

### M5 — Popup UI

- `entrypoints/popup/` (`index.html`, `main.ts`, `App.vue`, `style.css` with `@import 'tailwindcss';`).
- `stores/session.store.ts` — a Pinia store (`useSessionStore`) that calls `chrome.runtime.sendMessage({type: 'GET_SESSION_STATE'})` on mount and renders the result. **The popup never reads `chrome.storage` directly** — it only ever talks to background over the M3 message router, so background stays the single writer of session state and the popup is a pure read-through view. This matters because a popup is destroyed and recreated from scratch on every open (no persistent JS state to resume across opens), so there is no meaningful "Pinia persistence" problem to solve in Phase 1 — the store simply refetches every mount. (A generic Pinia-state-survives-popup-close problem exists for *later* phases that hold popup-local UI state across opens — e.g. a half-filled settings form — and is deliberately deferred; see "Open questions" below.)
- UI: a "Sites detected this session" list (origin + form count) and a "Vault — not yet implemented, arrives in Phase 2" placeholder section that makes no network or storage calls.
- Full implementation: `phase-1-runtime-architecture.md` §5.
- **Acceptance for M5**: opening the popup on a tab with a detected form shows that origin and form count; opening it on a tab with none shows the empty state; the vault placeholder renders with no console errors.

### M6 — End-to-end test

- Playwright, per WXT's own guidance that it's "the only good option" for this: `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=<path>', '--load-extension=<path>'] })` pointed at the real build output (`.output/chrome-mv3`), not a hand-maintained test fixture extension.
- Fixture pages: at least two distinct local origins, each with a login-shaped form (`<input type="email">`, `<input type="password">`, both `required`).
- Test flow: navigate to fixture origin 1 → open the popup (`chrome-extension://<id>/popup.html` directly, since Playwright can't click a real toolbar icon) → assert origin 1 appears with the right form count → navigate to fixture origin 2 → reopen the popup → assert **both** origins now appear (this is the real cross-navigation accumulation behavior a mocked-storage unit test can't fully exercise).
- Explicitly not attempted in Playwright: simulating the exact ~30-second MV3 service-worker idle-kill (Playwright doesn't reliably control this timing) — that property is covered by the manual checklist item in M7 plus the unit-level guarantee that every read/write already goes through `chrome.storage.session` rather than memory (M3).
- Full implementation shape: `phase-1-tooling-scaffold.md` §9, `phase-1-runtime-architecture.md` §6.

### M7 — Manual acceptance pass

Run through, in a real Chrome (and ideally Firefox, given it's an explicit target) profile with the production build loaded unpacked:

- [ ] Build produces an unpacked extension with no manifest errors and exactly the `storage` permission.
- [ ] A page with a form produces no console errors (page console or service-worker console).
- [ ] Popup shows the visited origin with a form count > 0.
- [ ] Visiting a second origin, then reopening the popup, shows **both** origins (proves accumulation, not just "most recent page").
- [ ] Manually terminating the service worker (`chrome://extensions` → service worker → "terminate", or waiting out the idle timer), then reopening the popup, **still shows the previously-detected origins** — this is the concrete, hands-on proof that `chrome.storage.session` persistence (not an in-memory `Map`) actually survives a real worker restart, not just a quick manual test that never gave the worker time to die.
- [ ] A page with no `<form>` produces no popup entry for that origin.
- [ ] The Vault placeholder is visible and inert (no network/storage calls).

Once M7 passes, update [`../roadmap.md`](../roadmap.md) to mark Phase 1 complete and note any deviations from this plan that implementation surfaced.

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

---

## What "done" means for Phase 1

All of M1–M7 pass, and the result is an installable, hot-reloadable browser extension that does exactly one useful thing end to end — notices forms on pages and remembers which origins had them, surviving a real service-worker restart — with every later phase's module boundary already named and stubbed, and nothing from those later phases implemented early.
