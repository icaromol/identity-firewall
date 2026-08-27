# Phase 1 Tooling & Scaffolding Spec

This document answers the ten scaffolding questions for Phase 1 ("Extension Foundation", `docs/roadmap.md` weeks 3–4) against the **actual current** WXT documentation and ecosystem as of 2026-08-27, not training-data assumptions. WXT and its plugin ecosystem move fast (the framework is pre-1.0 and versions its own breaking changes aggressively), so every section states the version/source checked and flags anything that looked ambiguous or version-sensitive. This is a planning document — no product code was written to produce it.

Versions confirmed live on npm at research time: **`wxt@0.21.4`**, **`tailwindcss@4.3.3`**.

---

## 1. Project initialization

**Command (current, canonical):**

```bash
pnpm dlx wxt@latest init
```

(equivalently `npx wxt@latest init`, `bunx wxt@latest init`, or `yarn dlx wxt@latest init` — the CLI prompts for a package manager choice if not inferred). Source: [wxt.dev/guide/installation](https://wxt.dev/guide/installation).

- **Official Vue template:** yes. The `init` wizard offers five starter templates: **Vanilla, Vue, React, Svelte, Solid**. Selecting "Vue" scaffolds `@wxt-dev/module-vue` already wired into `wxt.config.ts`.
- **TypeScript by default:** yes, explicitly. Docs state: *"All templates use TypeScript by default. To use JavaScript, change the file extensions."* No separate TS opt-in step is needed.
- **Recommended package manager:** the docs present npm, pnpm, Bun, and Yarn as co-equal options — **no single package manager is officially endorsed**. Given the rest of this project's tooling has no existing lockfile-format commitment, **recommend pinning to pnpm** for this project (fast, disk-efficient, and the form most WXT example repos and community guides default to in 2026), but this is a project preference, not a WXT requirement.
- **Generated `package.json` scripts** (from the template, confirmed current):
  ```json
  {
    "scripts": {
      "dev": "wxt",
      "dev:firefox": "wxt -b firefox",
      "build": "wxt build",
      "build:firefox": "wxt build -b firefox",
      "zip": "wxt zip",
      "zip:firefox": "wxt zip -b firefox",
      "postinstall": "wxt prepare"
    }
  }
  ```
  The `postinstall: wxt prepare` step matters — it's what (re)generates `.wxt/tsconfig.json` and the auto-import type declarations (see §8). Don't remove it.

**Recommendation:** pin the exact `wxt` version in `package.json` (`"wxt": "0.21.4"`, not `^0.21.4`) given the framework's pre-1.0 pace of breaking changes; bump deliberately, not automatically.

---

## 2. Manifest V3 configuration

`wxt.config.ts` declares manifest fields under a `manifest` key, either as a static object or a function of `{ browser, manifestVersion, mode, command }` for per-target variation. Source: [wxt.dev/guide/essentials/config/manifest](https://wxt.dev/guide/essentials/config/manifest).

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: ({ browser }) => ({
    permissions: ['storage'],
    // No host_permissions entry at all for Phase 1 — see rationale below.
  }),
});
```

**Minimal-permission mapping to our security-model.md principle:**

- `permissions: ['storage']` is the only permission Phase 1 needs (local state via `chrome.storage`/WXT's storage wrapper — see §4). It does **not** need `activeTab`, `scripting`, or `tabs` for its own runtime behavior. (WXT auto-adds `tabs`/`scripting` **only during `wxt dev`**, to support its hot-reload machinery — this is dev-only and stripped from production builds, confirmed by the docs' auto-permissions note. Don't hand-add these.)
- **No `host_permissions` entry.** This is the concrete point our `docs/research/attestto-teardown.md` precedent and `docs/security-model.md`'s "minimal permissions" principle both push toward: a content script's `matches` field (declared per-entrypoint via `defineContentScript`, see §3) governs *where the content script itself is injected* and does **not** require a corresponding `host_permissions` grant to run. `host_permissions` is a separate, broader grant needed only for **background-script-initiated** cross-origin `fetch`/`XMLHttpRequest` to those hosts — which Phase 1 has no reason to do (no network calls exist yet, consistent with `docs/security-model.md`'s "no unnecessary network calls" rule). Declare `matches: ['<all_urls>']` (or a narrower list once real target sites are known) on the content script entrypoint itself; leave `host_permissions` empty.
- The docs explicitly warn: if you *do* add `host_permissions` later and support both MV2 and MV3, keep the per-manifest-version list narrow and re-audit it before every release — worth carrying into our own release checklist once Phase 8 arrives.

**Cross-browser output:** WXT's CLI takes a `-b`/`--browser` flag (`wxt -b firefox`, default target is Chrome) and by default **targets MV3 for Chrome/Chromium/Edge and MV2 for Firefox/Safari**, switchable per-build with `--mv2`/`--mv3`. Runtime code can branch on `import.meta.env.BROWSER === 'firefox'` or the `import.meta.env.FIREFOX` shorthand, and on `import.meta.env.MANIFEST_VERSION`. Source: [wxt.dev/guide/essentials/target-different-browsers](https://wxt.dev/guide/essentials/target-different-browsers). Each browser/manifest-version combination builds into its own output directory (see §10/directory tree — `.output/chrome-mv3/`, `.output/firefox-mv2/`, etc.).

**Ambiguity flag:** the docs don't spell out an explicit sentence connecting content-script `matches` to host_permissions independence — that connection is stated as a design fact about MV3 generally (and matches what our own Attestto teardown already found), not a line WXT's docs assert in those words. Treat it as confirmed-by-precedent, not a direct WXT-docs quote.

---

## 3. Content script world (MAIN vs ISOLATED)

Declared per-entrypoint via `defineContentScript()`'s `world` option. File convention: `entrypoints/content.ts` (or `entrypoints/content/index.ts`, or `entrypoints/{name}.content.ts` for multiple named content scripts) → built to `content-scripts/{name}.js`. Source: [wxt.dev/guide/essentials/entrypoints](https://wxt.dev/guide/essentials/entrypoints.html), [wxt.dev/guide/essentials/content-scripts](https://wxt.dev/guide/essentials/content-scripts.html).

```ts
// entrypoints/content.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'ISOLATED', // default; omit for isolated, or set 'MAIN' explicitly
  main(ctx) {
    // has chrome.runtime.sendMessage, no page-JS access
  },
});
```

- **`world: 'MAIN'` constraints, per the docs:** MV3-only (incompatible with MV2), and **Chromium-only** — Firefox does not support the `world` option at all. A MAIN-world script has zero `chrome.*` API access, exactly as our `docs/research/webauthn-technical-notes.md` and the Attestto teardown already anticipated.
- **WXT's actual recommended pattern is *not* `world: 'MAIN'` directly** — it's the `injectScript` utility plus an **unlisted script** entrypoint (a file under `entrypoints/` with no recognized suffix, e.g. `entrypoints/injected.ts`, that WXT bundles but doesn't wire into the manifest itself). The pattern: an ISOLATED-world content script (with `chrome.*` access) calls `injectScript('/injected.js', ...)` to run the unlisted script inside the page's real MAIN world; the two sides then talk via `window.postMessage`/custom DOM events, and the ISOLATED-world script is the only one that ever calls `chrome.runtime.sendMessage` to reach the background. This is the same postMessage-relay shape our own docs already describe as necessary — WXT gives it a named utility (`injectScript`) and a recommended file layout (content script + sibling unlisted script) instead of leaving it to hand-rolled `<script>` injection.
- **Recommendation for our project:** given Firefox is an explicit cross-browser target (§2), prefer the `injectScript` + unlisted-script pattern over `world: 'MAIN'` — it's the only one of the two that works identically on both browsers.

---

## 4. Background service worker

File convention: `entrypoints/background.ts` (or `entrypoints/background/index.ts`) → built to `background.js`, declared via `defineBackground()`. Source: [wxt.dev/guide/essentials/entrypoints](https://wxt.dev/guide/essentials/entrypoints.html).

```ts
// entrypoints/background.ts
export default defineBackground({
  type: undefined, // set to 'module' for ESM background (MV3 only)
  main() {
    // registered once; no top-level runtime code outside main() —
    // WXT imports this file in a Node.js context during build.
  },
});
```

- **No built-in MV3 idle-termination mitigation.** WXT does not ship a keep-alive shim or any special handling for the ~30-second service-worker idle kill. This confirms the Attestto-derived lesson already written into `docs/browser-architecture.md` is something **we design around ourselves**, not something the framework solves: any pending-approval state must go into `chrome.storage.session` (or WXT's own storage wrapper with a `session:` key prefix — see below), never an in-memory `Map`/variable, because the background service worker's whole in-memory state (including that variable) is discarded on idle termination and a fresh worker instance has no memory of it.
- **WXT's storage wrapper directly supports this.** WXT ships `wxt/utils/storage` (imported as `storage`, or via its `#imports` auto-import), with `storage.defineItem<T>('session:key', { defaultValue, version })` mapping straight onto `chrome.storage.session` (in-memory, cleared on browser restart/extension reload/disable — exactly the RAM-only semantics `docs/security-model.md` already specifies for the vault unlock key, and exactly what a pending-approval queue needs). Other prefixes: `local:` → `chrome.storage.local`, `sync:` → `chrome.storage.sync`, `managed:` → enterprise-managed read-only storage. `storage.watch()` supports reactive subscriptions. Source: [wxt.dev/storage](https://wxt.dev/storage) plus corroborating community/DeepWiki pages (the canonical page's fully rendered prose wasn't fetchable via the automated summarizer used for this research pass — cross-check the live `defineItem`/prefix table on `wxt.dev/storage` directly before relying on exact method signatures in implementation).
- Background bundles as an IIFE by default; set `type: 'module'` in the `defineBackground` options for ESM (MV3 only — MV2 doesn't support module service workers/background pages this way).

---

## 5. Popup entrypoint

Convention: `entrypoints/popup/` as a directory containing `index.html`, `main.ts`, `App.vue` (and optionally `style.css`), matching the general WXT rule that "each entrypoint should be a directory with its own files" once it needs more than one file. Flat `entrypoints/popup.html` also works for a single-file popup but doesn't fit a real Vue app. Source: [wxt.dev/guide/essentials/frontend-frameworks](https://wxt.dev/guide/essentials/frontend-frameworks), [wxt.dev/guide/essentials/entrypoints](https://wxt.dev/guide/essentials/entrypoints.html).

- Popup-specific manifest fields (e.g. `default_icon`, `browser_action` vs `page_action` type) are set via `<meta name="manifest.*" content="...">` tags inside `entrypoints/popup/index.html` itself, not in `wxt.config.ts`.
- **Vue Router caveat (relevant if the popup ever grows multi-view):** because extension pages are static HTML files, not server routes, WXT's docs flag that a router must run in **hash mode** (`popup.html#/some/route`) rather than history mode. Worth remembering once the popup UI grows past a single view.
- **`options_ui` (full-tab settings page) is supported the same way**, confirming the Attestto-style choice noted in `docs/browser-architecture.md`: `entrypoints/options/` (same `index.html`/`main.ts`/`App.vue` shape as popup) with a `<meta name="manifest.open_in_tab" content="true">` tag to force it to open as a full tab rather than the small default popover WXT/Chrome otherwise renders it as.

---

## 6. Tailwind integration

**Current major version: Tailwind CSS v4** (`4.3.3` confirmed live on npm at research time), which uses **CSS-first configuration** (a `@import 'tailwindcss'` directive plus `@theme`/`@source` at-rules directly in a CSS file) rather than v3's `tailwind.config.js` + PostCSS pipeline. Recommend targeting v4, not v3 — v3's JS-config approach is legacy at this point and community WXT examples have already moved to the `@tailwindcss/vite` plugin.

**Wiring (community-confirmed pattern, no single official "WXT + Tailwind" doc page exists — this is assembled from WXT GitHub discussions and example repos, not one canonical source):**

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
```

```css
/* entrypoints/popup/style.css (or a shared assets/tailwind.css) */
@import 'tailwindcss';
```

Then import that CSS file from `main.ts` or reference it in `index.html`. Each entrypoint that wants Tailwind classes needs its own CSS entrypoint importing `tailwindcss` this way (WXT treats CSS files as "unlisted" entrypoints implicitly bundled wherever imported) — there's no single global stylesheet auto-applied to every entrypoint.

**Shadow DOM caveat (relevant later, not Phase 1):** if a content-script UI ever renders inside a shadow root (WXT's `createShadowRootUi` helper), Tailwind's `rem`-based utilities compute against the *page's* root `<html>` font-size, not the shadow root's — a known gotcha flagged in the WXT community discussions, worth remembering when Phase 3's in-page approval UI is built, not relevant to the popup/options pages in Phase 1.

**Ambiguity flag:** unlike the Vue module or storage API, Tailwind integration has no first-party WXT module (no `@wxt-dev/module-tailwind`) — it's wired in generically via `@tailwindcss/vite`, WXT's standard passthrough of Vite plugins. This is stable but community-pattern, not WXT-blessed API surface, so it's slightly more exposed to breaking on a future Tailwind major bump.

---

## 7. Pinia integration

No first-party WXT module for Pinia (unlike Vue itself, which gets `@wxt-dev/module-vue`). Pinia is wired in exactly as in any Vue 3 app — `createPinia()` installed on the app instance in `entrypoints/popup/main.ts`.

**Popup lifecycle problem (directly relevant to our architecture):** a browser action popup is **destroyed on close and recreated from scratch on every open** — it is not a persistent context (unlike the background service worker, which at least persists in principle between kills). This means **Pinia's default in-memory store state does not survive a popup close**, at all — there's no "the popup was just suspended" state to resume, the whole document and its JS state is gone. Any Pinia store holding data the user should still see next time they open the popup (e.g. "pending approval for this tab", "last-selected identity") must be:

1. Written to `chrome.storage` (WXT's `storage.defineItem`, `local:` or `session:` prefix as appropriate) on every mutation, not just on popup close (there is no reliable "popup closing" hook to flush state at the last moment — MV3 discards the page essentially synchronously).
2. Rehydrated from that storage on Pinia store initialization (`main.ts`, before mounting `App.vue`), every single popup open.

A community plugin exists for this (`pinia-plugin-webext-storage`, offering `beforeRestore`/`afterRestore` hooks around browser.storage-backed persistence), but it's a third-party package, not WXT- or Pinia-core-maintained — worth evaluating at implementation time rather than treating as a settled dependency now. The simpler, more auditable option (fitting `docs/security-model.md`'s general preference for fewer dependencies) is a small hand-rolled Pinia plugin that subscribes to `store.$subscribe` and writes through to a `storage.defineItem`, since our actual persisted-state surface in Phase 1 is small (no vault/firewall logic yet).

---

## 8. TypeScript config

WXT auto-generates `.wxt/tsconfig.json` on `wxt prepare` (which runs automatically via the template's `postinstall` script, see §1, and again on every `wxt dev`/`wxt build`). The root `tsconfig.json` should be minimal and simply extend it:

```json
{
  "extends": "./.wxt/tsconfig.json"
}
```

Source: [wxt.dev/guide/essentials/config/typescript](https://wxt.dev/guide/essentials/config/typescript).

- **Do not hand-edit `.wxt/tsconfig.json`** — it's regenerated every `wxt prepare` run and any manual edits are silently discarded.
- Built-in path aliases: `~` and `@` → source root; `~~` and `@@` → project root. Custom aliases belong in `wxt.config.ts`'s `alias` option, not in a hand-maintained `tsconfig.json` `paths` block (WXT owns that block).
- For compiler-option overrides beyond simple scalar values (e.g. merging in a `types` array), WXT exposes a `prepare:tsconfig` build hook rather than expecting you to fight the generated file directly.
- For monorepo setups where `extends` doesn't fit, a `/// <reference path="./.wxt/wxt.d.ts" />` triple-slash directive is the documented fallback — not relevant to this single-package project, but worth knowing it's the escape hatch.

---

## 9. Testing tooling

### Unit tests: Vitest via `WxtVitest`

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
});
```

Source: [wxt.dev/api/reference/wxt/testing/vitest-plugin/functions/wxtvitest](https://wxt.dev/api/reference/wxt/testing/vitest-plugin/functions/wxtvitest), [wxt.dev/guide/essentials/unit-testing](https://wxt.dev/guide/essentials/unit-testing).

`WxtVitest()` pulls in the project's actual `wxt.config.ts` (Vite config, plugins, auto-imports), sets WXT's `import.meta.env.BROWSER`/`MANIFEST_VERSION` globals, resolves the `@/*`/`@@/*` aliases, and — most importantly for testing anything that touches storage or messaging — polyfills the `browser`/`chrome` extension API with an **in-memory fake** via `@webext-core/fake-browser` (`wxt/testing/fake-browser`), reset per-test with `fakeBrowser.reset()` in a `beforeEach`. This means Phase 1's storage-wiring and message-passing logic is unit-testable without a real browser at all. One caveat surfaced in the docs: when mocking a specific WXT util directly, target its real import path (visible in `.wxt/types/imports-module.d.ts`) rather than the `#imports` virtual module, since Vitest doesn't preprocess `#imports` the way the WXT build does.

### E2E: Playwright against the built unpacked extension

WXT's own e2e-testing guide states plainly: *"Playwright is the only good option for writing Chrome Extension end-to-end tests,"* and defers to Playwright's own extension docs for the mechanics, pointing at its own `examples/playwright-e2e-testing` reference project. Source: [wxt.dev/guide/essentials/e2e-testing](https://wxt.dev/guide/essentials/e2e-testing), [playwright.dev/docs/chrome-extensions](https://playwright.dev/docs/chrome-extensions).

Point the test harness at WXT's real build output directory — `.output/chrome-mv3` (or the equivalent per-browser/per-manifest-version output dir from §2/§10) — **not** a separately maintained test fixture extension.

Confirmed current Playwright API shape (extensions require a **persistent context**; normal `browser.launch()` does not support them):

```ts
import path from 'node:path';
import { chromium } from '@playwright/test';

const pathToExtension = path.join(__dirname, '.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
  ],
});

let [serviceWorker] = context.serviceWorkers();
if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
const extensionId = serviceWorker.url().split('/')[2];
```

Note the `channel: 'chromium'` option is what permits this to run headless with an extension loaded; without it Playwright historically required headed Chromium for extension tests. The MV3 service worker can still idle-suspend mid-test-run (the same lifecycle issue as §4) — the `Worker` handle Playwright hands back stays valid across that suspend/resume, per Playwright's own docs, so tests don't need to special-case it, but any test asserting on background-held in-memory state needs to go through `chrome.storage` reads instead, consistent with the storage-not-memory rule from §4.

---

## 10. Dev workflow

- **Dev server with hot reload:** `pnpm dev` (→ `wxt`) for Chrome, `pnpm dev:firefox` (→ `wxt -b firefox`) for Firefox. WXT's dev server rebuilds on file change and pushes updates into an already-running browser instance it launches and controls directly — no manual "reload extension" click needed for most changes (WXT auto-adds the `tabs`/`scripting` dev-only permissions mentioned in §2 specifically to support this reload mechanism).
- **Manual load, Chrome:** `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select the build output directory, `.output/chrome-mv3` (or `.output/chrome-mv3-dev` when running via `wxt dev`, which uses a distinct dev-mode output folder — confirm the exact dev-vs-build folder name against the version pinned at implementation time, as this is one of the more likely-to-shift path details across WXT releases).
- **Manual load, Firefox:** `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select the `manifest.json` inside `.output/firefox-mv2` (or whatever the Firefox output directory is named for the pinned WXT version).
- **Production build:** `pnpm build` / `pnpm build:firefox` → `wxt build [-b firefox]`, output to `.output/{browser}-{manifestVersion}/`. `pnpm zip` / `pnpm zip:firefox` → `wxt zip` packages that output directory into a store-submittable `.zip`.

---

## Proposed directory tree (end of Phase 1 scaffolding)

Reflects WXT's actual current entrypoint-discovery conventions (§3–§5) rather than a generic guess — directory-form entrypoints are used throughout since every entrypoint here needs more than one file (Vue popup/options apps) or, for content scripts, a sibling unlisted script for the MAIN-world relay pattern from §3.

```text
identity-firewall-ext/
├── .wxt/                          # auto-generated by `wxt prepare` — gitignored
│   ├── tsconfig.json
│   └── types/
├── .output/                       # build artifacts — gitignored
│   ├── chrome-mv3/
│   └── firefox-mv2/
├── assets/                        # WXT convention: processed/bundled non-entrypoint assets
│   └── tailwind.css               # shared `@import 'tailwindcss';` entry, if not per-entrypoint
├── public/                        # WXT convention: static, unprocessed, copied as-is (icons, etc.)
│   └── icon/
│       ├── 16.png
│       ├── 48.png
│       └── 128.png
├── entrypoints/
│   ├── background.ts              # defineBackground() — pending-approval state → storage.session, not memory
│   ├── content/
│   │   └── index.ts                # defineContentScript(), world: 'ISOLATED' (default) — chrome.* access, calls injectScript()
│   ├── injected.ts                 # unlisted script — runs in the page's real MAIN world via injectScript(); no chrome.* access
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.ts                 # createApp + createPinia; rehydrates Pinia state from chrome.storage before mount
│   │   ├── App.vue
│   │   └── style.css               # @import 'tailwindcss';
│   └── options/
│       ├── index.html              # <meta name="manifest.open_in_tab" content="true">
│       ├── main.ts
│       ├── App.vue
│       └── style.css
├── components/                     # shared Vue components used by popup/options (auto-imported)
├── stores/                         # Pinia stores, with a storage-backed persistence plugin
├── utils/                          # shared TS helpers (e.g. message-passing types/schemas)
├── tests/
│   ├── unit/                       # Vitest, via WxtVitest plugin
│   └── e2e/                        # Playwright, launchPersistentContext against .output/chrome-mv3
├── wxt.config.ts                   # manifest (permissions: ['storage'], no host_permissions), modules: ['@wxt-dev/module-vue'], vite: tailwindcss()
├── vitest.config.ts                # WxtVitest() plugin
├── playwright.config.ts
├── tsconfig.json                   # { "extends": "./.wxt/tsconfig.json" }
├── package.json
└── pnpm-lock.yaml
```

---

## Sources consulted

- [wxt.dev/guide/installation](https://wxt.dev/guide/installation)
- [wxt.dev/guide/essentials/config/manifest](https://wxt.dev/guide/essentials/config/manifest)
- [wxt.dev/guide/essentials/entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)
- [wxt.dev/guide/essentials/content-scripts](https://wxt.dev/guide/essentials/content-scripts.html)
- [wxt.dev/guide/essentials/frontend-frameworks](https://wxt.dev/guide/essentials/frontend-frameworks)
- [wxt.dev/guide/essentials/e2e-testing](https://wxt.dev/guide/essentials/e2e-testing)
- [wxt.dev/guide/essentials/unit-testing](https://wxt.dev/guide/essentials/unit-testing)
- [wxt.dev/api/reference/wxt/testing/vitest-plugin/functions/wxtvitest](https://wxt.dev/api/reference/wxt/testing/vitest-plugin/functions/wxtvitest)
- [wxt.dev/guide/essentials/config/typescript](https://wxt.dev/guide/essentials/config/typescript)
- [wxt.dev/guide/essentials/target-different-browsers](https://wxt.dev/guide/essentials/target-different-browsers)
- [wxt.dev/storage](https://wxt.dev/storage)
- [playwright.dev/docs/chrome-extensions](https://playwright.dev/docs/chrome-extensions)
- npm registry: `wxt@0.21.4`, `tailwindcss@4.3.3` (checked directly, 2026-08-27)
- Community/secondary corroboration (not treated as primary source, used only to cross-check patterns not fully spelled out on wxt.dev): GitHub `wxt-dev/wxt` discussions #819, #1318, #523; `wxt-dev/examples`; `ohmree/pinia-plugin-webext-storage`.
- Project precedent: `docs/research/attestto-teardown.md`, `docs/research/webauthn-technical-notes.md`, `docs/security-model.md`, `docs/browser-architecture.md`.
