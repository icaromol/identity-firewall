# Phase 6 — Extension Dashboard (narrowed scope)

**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 6. **Objectives:** a standalone Options page, reached outside the popup, with exactly three tabs — "Who knows what about me" extended to every site (not just the active tab), Personal Data, and Backup & Recovery — with the Personal Data and Backup/Recovery sections removed from the popup and relocated here. **Deliverable:** the first UI surface in the project that isn't the popup.

This narrows Phase 6's originally-scoped four killer features (`product-vision.md` §7) down to one: 7.1, extended from per-active-tab to all-sites. **Revoke Identity (7.2), Privacy Score (7.3), and the disclosure-reduction metric (7.4) are dropped from this phase entirely — confirmed directly with the user — and have no scheduled phase as of this writing.** Stated here plainly rather than silently dropped, per this project's own transparency principle (CLAUDE.md's 7 non-negotiable principles, #6).

## Key design decisions

1. **Reached via the extension's own Options page** (WXT's `entrypoints/options/` convention → MV3's `options_ui`), not a popup-launched tab or a New Tab override — confirmed with the user.
2. **Opens as a full browser tab**, not the embedded dialog `chrome://extensions` shows by default for an options page — WXT exposes this via `<meta name="manifest.open_in_tab" content="true" />` in the entrypoint's own `<head>` (confirmed against WXT's own entrypoints docs).
3. **Hand-rolled Tailwind tabs, not shadcn-vue** — confirmed with the user. shadcn/ui itself is React-only and doesn't apply to this Vue 3 codebase; shadcn-vue is a real, separate Vue port, explicitly rejected in favor of staying consistent with the popup's own existing zero-UI-library convention.
4. **No new storage tier or permission.** `readVaultIndex().privacyLedger` is already one flat array spanning every origin (`background/policy/ledger.ts`'s `recordDisclosure` appends to it unfiltered); `GET_PRIVACY_LEDGER` merely narrows that same array to one origin today. The all-sites tab just reads the same array without the origin filter. The Options page needs none of `activeTab`'s tab-inspection behavior either — every one of its three tabs is either origin-agnostic (Personal Data, Backup & Recovery) or spans all origins by design (the ledger tab) — so `wxt.config.ts`'s permissions list is untouched.
5. **This is the first UI surface that isn't the popup**, so it's also the first time a Pinia store is mounted from two independent page contexts. Popup and options each get their own JS execution context and their own Pinia instance — no shared runtime state between them, only whatever round-trips through `browser.runtime.sendMessage`. `stores/personalData.store.ts` and `stores/vault.store.ts` are reused unchanged (both were already page-agnostic); a new `stores/allSitesLedger.store.ts` is added rather than overloading `stores/privacyLedger.store.ts`, since that store's whole shape is built around `resolveActiveTab()`-scoping a single origin and this page has no active-tab concept at all.
6. **The "Who knows what about me" tab only lists origins with at least one recorded ledger entry** — an origin the user has a Service Identity for but never actually disclosed or denied anything to (e.g. everything still pending) doesn't appear. This matches `product-vision.md`'s own framing ("what did I hand over") and keeps this milestone from also becoming a second, unrelated "list every known origin" feature.
7. **A real UX tradeoff, shipped as asked rather than silently worked around**: today, Restore-from-backup is shown specifically in the popup's *pre-initialization* branch (setting up a new device from a backup file, before any vault exists there yet), while Export is shown only once a vault is *unlocked*. Moving both fully out of the popup means a brand-new user with no vault yet must know to find the Options page to restore, rather than seeing it offered right alongside "Set up a new vault." The user asked for both removed from the popup outright, so that's what ships; the Backup & Recovery tab shows its own state-appropriate messaging for uninitialized/locked/unlocked instead.

## Milestone breakdown

### M1 — Options page scaffold

- New entrypoint: `entrypoints/options/index.html` (`<meta name="manifest.open_in_tab" content="true" />` in the head), `entrypoints/options/main.ts` (identical to the popup's own `createApp(App).use(createPinia()).mount('#app')`), `entrypoints/options/App.vue` (a hand-rolled tab strip: three buttons, an `activeTab` ref, `v-show`/`v-if` panels — same Tailwind visual language as the popup, not a new one).
- Verify empirically, not by assumption, that WXT actually maps this entrypoint into the built manifest's `options_ui`/`options_page` field and that `open_in_tab` behaves as expected, by inspecting the generated `.output/.../manifest.json` after a build — matching this project's own established "verify tooling facts empirically" convention (Phase 1's "browser not chrome" precedent).

### M2 — All-sites Privacy Ledger read

- New message `GET_ALL_PRIVACY_LEDGER` (`shared/messages.ts`) — no payload, since it's origin-agnostic by definition — following the exact schema/type-export pattern `GetPrivacyLedgerMessageSchema`/`GetPrivacyLedgerMessage`/`GetPrivacyLedgerResponse` already establish.
- New handler `handleGetAllPrivacyLedger` (`background/policy/handler.ts`): reads `readVaultIndex().privacyLedger` and returns it unfiltered. Registered in `background/router/registry.ts` under the same `capability: 'policy'` used for `GET_PRIVACY_LEDGER`.
- New store `stores/allSitesLedger.store.ts`: fetches the full entry list; the options page's own component groups it by `entry.origin` and aggregates "most-recent-per-field-wins" per group, reusing the same logic the popup's existing `ledgerSummary` computed already applies to a single origin.

### M3 — Personal Data tab

- Move the "Personal data" section (markup + script: the `usePersonalDataStore` instance, `personalDataForm`, `submitPersonalData`, its slice of `refreshVaultScopedSections()`) out of `entrypoints/popup/App.vue` and into the Options page's "Personal data" panel, behavior unchanged.
- Remove `personalData.fetchPersonalData()` from the popup's `refreshVaultScopedSections()` — the other stores it refreshes (session, firewall, privacyLedger, pendingCredential, savedCredentials) stay in the popup untouched; only the personalData slice is deleted since the section no longer lives there.
- `tests/e2e/personalData.test.ts` retargeted at `options.html` instead of `popup.html` for the form itself (vault setup/unlock still happens through the popup first, since that's a precondition regardless of which page shows the form).

### M4 — Backup & Recovery tab

- Move the Export-backup form and Restore-from-backup form (markup + script: `exportPassphrase`, `submitExportBackup`, `restoreFile`, `restoreBackupPassphrase`, `restoreNewPassphrase`, `onRestoreFileSelected`, `clickRestoreWithPasskey`, `submitRestoreWithPassphrase`) out of the popup's Vault section into the Options page's "Backup & recovery" panel. Setup/lock/unlock stay in the popup untouched.
- The Options page fetches its own `vault.fetchStatus()` (a separate Pinia instance means no state is inherited from whatever the popup already fetched) to gate this tab's messaging: no vault yet → point back to the popup for setup, offer restore; locked → point back to the popup to unlock; unlocked → the real export/restore forms.

### M5 — Manual verification + docs sync

- Real-browser pass: load the unpacked extension, open the Options page via `chrome://extensions`'s own "Details" link (confirms the manifest wiring, not just that `pnpm dev` serves the file), confirm it opens in a full tab; exercise all three tabs against a real vault end to end, including a real export → restore into a second fresh profile round trip.
- `docs/roadmap.md`'s Phase 6 section rewritten for the narrowed scope, explicitly noting 7.2/7.3/7.4 are dropped with no phase assigned.
- `docs/product-vision.md`'s existing §7 scheduling note corrected to match (7.1 is the only killer feature Phase 6 delivers).
- `CLAUDE.md`'s status line updated once complete.

## Verification

- `pnpm check` green after each milestone.
- New unit tests: `handleGetAllPrivacyLedger` (multi-origin, empty), `stores/allSitesLedger.store.ts` (fetch success/error).
- e2e: relocated Personal Data scenarios now driving `options.html`; a new test confirming the tab strip renders and switches panels. None of these three tabs depend on `browser.tabs.query` the way the popup's firewall/single-origin-ledger sections do, so none of them need the graceful-degradation-only treatment that limitation forces elsewhere in this codebase.
- `/code-review` (or a documented manual fallback if rate-limited) after each milestone.

## Implementation (as built)

Built as planned across M1–M4, verified in M5. `pnpm build`'s generated `.output/chrome-mv3/manifest.json` confirmed WXT's actual mapping empirically rather than by assumption: `"options_ui":{"open_in_tab":true,"page":"options.html"}`, with `permissions` unchanged (`["storage","activeTab"]`) — exactly as decision 4 predicted.

**One real bug found only by writing the e2e test, not by inspection**: the three tab panels were initially built with `v-show` (matching a natural instinct to keep all three mounted so switching tabs never re-fetches). Since `v-show` only toggles CSS `display`, every panel's content — including error strings — stays in the DOM even while hidden. `GET_ALL_PRIVACY_LEDGER` and `GET_PERSONAL_DATA` both read the same encrypted vault index, so on a fresh, uninitialized vault both legitimately fail with the identical string `"VAULT_LOCKED"` — meaning two different panels' error paragraphs held the same text simultaneously, and Playwright's `getByText('VAULT_LOCKED', { exact: true })` hit a strict-mode violation (resolved to 2 elements) the moment both panels' fetches had settled. Fixed by switching all three panels from `v-show` to `v-if`: safe here since every `ref`/`reactive` the templates bind to lives in the parent component's own `setup()`, not inside the panel itself, so unmounting an inactive panel and remounting it later loses no state. This is the kind of gap that's invisible to a human clicking through the UI (only one panel is ever visually on screen) and only surfaces once something asks "what's actually in the DOM right now" — exactly what an automated test does and a manual pass doesn't.

**M5's manual verification** was carried out through the automated build this project already treats as its "real browser" bar (matching Phases 1–5's own precedent: a headless-but-real Chromium loading the actual production `.output/chrome-mv3` build, not a mock) — `tests/e2e/dashboard.test.ts` and the relocated `tests/e2e/personalData.test.ts` exercise: the Options page opening with the tab strip and correct default tab; every tab's locked/unlocked/uninitialized messaging; a real encrypted Personal Data round trip surviving a reload; and a real `EXPORT_VAULT_BACKUP` round trip producing a genuine downloadable, schema-valid backup file from the relocated Backup & Recovery tab. A full export → restore-into-a-second-profile round trip was not additionally re-verified here, since `RESTORE_VAULT_BACKUP`/`EXPORT_VAULT_BACKUP`'s own crypto and schema correctness were already proven end-to-end by Phase 2 M7's tests and are unchanged by this move — Phase 6's own risk was only "does the relocated UI still call them correctly," which the export test above covers directly.

`docs/roadmap.md`'s Phase 6 section, `docs/product-vision.md`'s §7 scheduling note, and `CLAUDE.md`'s status line were all updated to reflect the narrowed scope and completion.
