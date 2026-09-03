# Auto-Lock, a Configuration tab, and per-field default policies

**Status:** Complete (M1-M6). Manually verified in a real Chromium browser: an OS screen lock (Win+L) locks the vault immediately regardless of configured duration, and the 30-second idle timer itself locks the vault once genuine system-wide inactivity is reached.
**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 7 Part A ("Vault Session Security & Biometric Authorization"). Folded into the existing, not-yet-started Phase 7 alongside biometrics (Part B) rather than triggering a third full roadmap renumbering — both parts are about the vault's authorization lifecycle, neither depends on the other, and Phase 2 already has precedent for one phase carrying two plan docs (`phase-2-local-identity-vault.md` + `phase-2-vault-tiering-refactor.md`).

## Context

Three related gaps, all raised together by the user:

1. **No auto-lock.** The vault only ever locks when the user explicitly clicks Lock. A device left unattended with the vault unlocked stays unlocked indefinitely — a real gap in the vault's own security posture, not covered by any existing phase or doc.
2. **No UI for account-wide behavior defaults** (how long until auto-lock, whether a saved login auto-fills or waits for a click, whether a captured login auto-saves or asks first) — the user wants a new **Configuration** tab in the Dashboard (`entrypoints/options/`) for these.
3. **The Policy Engine's global per-field defaults have never had a UI.** `GET_POLICIES`/`SET_POLICY`/`DELETE_POLICY` (`background/policy/`) have existed since Phase 4 and are fully working, but confirmed by grep: **nothing anywhere in the popup or Dashboard ever calls them.** The user wants a dropdown next to each field in the Dashboard's existing "Personal data" tab (Real/Alias/Synthetic/Nonsense/Deny/Ask) — this is the exact "backend built, no UI" pattern Phase 5 already closed once for `GET_PERSONAL_DATA`/`GET_CREDENTIAL`.

**Module boundary, confirmed directly with the user:** a new, separate module holds only *app behavior/preferences* — auto-lock duration, credential save/fill mode — organized so it could later be extracted into its own service (its own storage namespace, its own message capability, no reach into vault internals beyond calling `lockVault()`). The per-field default-policy dropdowns (item 3) are **not** part of that module — they're the Policy Engine's own existing disclosure-behavior logic (core privacy domain, `background/policy/`), just finally getting a UI.

## Key design decisions

1. **Auto-lock via `chrome.idle`, not `chrome.alarms`.** `chrome.alarms` clamps to a 1-minute floor in production, incompatible with the user's own 30-second default. `chrome.idle.setDetectionInterval()` has a confirmed 15-second floor ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/idle/setDetectionInterval), [Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/idle)) and reports `'active' | 'idle' | 'locked'` based on system-wide keyboard/mouse input — the idiomatic mechanism this exact feature exists for, and how comparable password-manager extensions implement their own auto-lock. `'locked'` (OS screen lock) triggers the vault lock too, not just `'idle'` — a screen lock is an even stronger "walked away" signal.
2. **System-wide idle, not extension-specific activity.** `chrome.idle` fires based on activity anywhere on the computer, not specifically inside this extension's own UI. Considered tracking "time since last message reached this extension" instead (stricter — would lock even while the user is actively browsing other tabs), but `chrome.idle` matches user expectations set by 1Password/Bitwarden-style tools and needs no new activity-tracking plumbing of our own. Flagged here explicitly since it's a real, consequential choice, not an oversight — reopen this decision if the stricter model is actually what's wanted.
3. **Auto-lock reuses `lockVault()` (`background/vault/unlock.ts:49`) directly** — the exact same one-line `clearCachedUnlockKey()` call `VAULT_LOCK` already uses. No new locking logic anywhere.
4. **Credential auto-*fill*, not just auto-save, is explicitly deferred to Phase 8.** `docs/roadmap.md`'s Phase 8 objectives already say: *"Auto-login when the vault is already unlocked; otherwise require the device's own biometric/Windows Hello prompt first — this is the reason this phase must come after Phase 7, not before it."* Silently filling a saved credential onto a page with zero human confirmation is the same security territory Phase 8 is deliberately gated behind biometrics for, regardless of whether it's triggered from an in-page icon (Phase 8's own surface) or a popup that auto-triggers Fill. This plan's Configuration tab shows "Auto-fill" as a visibly present but disabled option with a tooltip explaining why, rather than building ahead into Phase 8's own territory (CLAUDE.md's own explicit rule) or hiding the roadmap gap silently.
5. **Credential auto-*save* is in scope now.** Unlike auto-fill, auto-save never discloses anything to a third party — it only skips the existing "Save this login?" confirmation for writing to the user's own local vault. This doesn't touch principle 4 ("explicit consent — sensitive data is never shared silently"), since nothing is being *shared*; a toast still confirms what happened so the switch to silent behavior isn't invisible.
6. **Per-field default dropdowns need zero backend changes.** `PolicyRuleSchema`/`PolicyActionSchema` (`shared/vault-schema.ts:120,268`) and the `GET_POLICIES`/`SET_POLICY`/`DELETE_POLICY` handlers (`background/policy/handler.ts`) already do exactly this, scoped via `{ kind: 'global' }`. This milestone is pure UI, reusing `availableResponses()`'s existing sensitivity-based option filtering (`background/firewall/responseAvailability.ts`) so e.g. `nationalId` still only ever offers Real/Deny.

## New module: `background/settings/`

Deliberately separate from `background/vault/`, `background/policy/`, `background/firewall/`, `background/identity/` — its own storage namespace, its own message capability, and exactly one call *into* another module (`lockVault()`), never the reverse.

- `background/settings/storage.ts` — reads/writes an `AppSettings` object under its own `chrome.storage.local` key (e.g. `app-settings`), never touching `background/vault/storage.ts`'s tiers.
- `shared/settings.ts` (or a new section of `shared/messages.ts`) — `AppSettingsSchema`: `{ autoLockSeconds: number | null; credentialSaveMode: 'ask' | 'auto' }`. `null` means "never auto-lock." `credentialFillMode` is *not* in this schema yet (nothing to configure until Phase 8 makes 'auto' real) — the Configuration tab's "Auto-fill" control is presentational-only, not backed by a setting.
- `background/settings/idleLock.ts` — registers `chrome.idle.onStateChanged` at the background script's top level (so it re-registers on every MV3 service-worker respawn, matching this codebase's existing listener-registration convention) and calls `lockVault()` when state is `'idle'` or `'locked'` and the vault is currently unlocked. Applies `chrome.idle.setDetectionInterval()` (clamped to the 15s floor) on startup and whenever `autoLockSeconds` changes; when `autoLockSeconds` is `null`, the listener still runs but no-ops.
- `background/settings/handler.ts` — `handleGetAppSettings`/`handleSetAppSettings` (patch-style, matching `SET_PERSONAL_DATA`'s own convention).
- New router capability `'settings'` in `background/router/registry.ts`'s `Capability` union, registering `GET_APP_SETTINGS`/`SET_APP_SETTINGS`.
- `wxt.config.ts` — add `'idle'` to `manifest.permissions`.
- `stores/appSettings.store.ts` — the Configuration tab's own store, same fetch/save shape as `stores/personalData.store.ts`.

## Policy Engine UI (no new module)

- `stores/policies.store.ts` (new store, existing backend) — `fetchPolicies()`/`setPolicy()`/`deletePolicy()` wrapping the three existing messages.
- `entrypoints/options/App.vue`'s existing "Personal data" tab: one dropdown per field (name/email/phone/nationalId/address/birthDate), populated from `availableResponses(fieldType, ...)` plus `'ask'`, defaulting to whatever global `PolicyRule` currently exists for that field (or the baseline from `PERSONAL_DATA_FIELD_DEFAULT_ACTION` shown as a placeholder/hint when no explicit rule is set). Selecting a value calls `SET_POLICY`; explicitly resetting to "no override" calls `DELETE_POLICY`.

## Dashboard: new "Configuration" tab

Fourth tab (`entrypoints/options/App.vue`'s `TABS` array), icon e.g. `Settings` (`@lucide/vue`):

- **Auto-lock after** — a `<select>`: 30 seconds (default), 1 minute, 5 minutes, 15 minutes, 30 minutes, 1 hour, Never. Writes `autoLockSeconds` via `appSettings.store.ts`.
- **Saving a new login** — Ask before saving (default, current Phase 5 behavior) / Auto-save. Writes `credentialSaveMode`.
- **Filling a saved login** — Manual (current Phase 5 behavior, the only real option) / Auto-fill, disabled, wrapped in `UiTooltip` ("Coming in a later phase, once biometric authorization gates it — see Phase 8"). No setting written for this row yet.

## Wiring `credentialSaveMode: 'auto'` into capture

`background/vault/credentials/handler.ts`'s existing capture-staging path (wherever a `FORM_SUBMITTED` login/signup currently becomes a `PendingCredential` for the popup's "Save this login?" prompt) reads `credentialSaveMode` before staging: if `'auto'`, skip staging entirely and call the same save logic `CONFIRM_PENDING_CREDENTIAL` already uses, immediately. The popup's own "Save this login?" section (`entrypoints/popup/App.vue`) never appears in this mode. A toast (`stores/shared/toast.store.ts`) fires from wherever the content-script/background round trip surfaces to the popup, confirming "Login saved automatically." so silent behavior is never invisible.

## Milestones

- **M1 — `background/settings/` scaffolding. Complete.** Storage, schema, handler, router registration, `GET_APP_SETTINGS`/`SET_APP_SETTINGS`, `stores/appSettings.store.ts`.
- **M2 — Auto-lock mechanism. Complete.** `background/settings/idleLock.ts`, the `'idle'` permission, wiring `chrome.idle.onStateChanged` to `lockVault()`. Confirmed: `wxt/testing/fake-browser` does **not** mock `chrome.idle` at all (throws `MockNotImplementedError` on any call) — unit tests stub it via `vi.spyOn`.
- **M3 — Configuration tab UI. Complete.** The new Dashboard tab, wired to `appSettings.store.ts`; the disabled "Auto-fill" placeholder and its tooltip.
- **M4 — Credential auto-save wiring. Complete.** `credentialSaveMode: 'auto'` actually skips the popup prompt via `saveCredential()`, falling back to staging when the Vault is locked; a one-time `autoSaveNotice.ts` flag stands in for a live toast (popups don't stay mounted to receive a background push at an arbitrary later moment).
- **M5 — Personal Data per-field policy dropdowns. Complete.** `stores/policies.store.ts`, the six dropdowns in the existing "Personal data" tab, `GET_POLICIES` extended with server-computed `availableResponses`.
- **M6 — Manual verification + docs sync. Complete.** ADR-017/ADR-018 written (below); `CLAUDE.md` status line updated. Manually verified in a real Chromium browser: Win+L locks the vault immediately (the 'locked' override), and the 30-second idle timer locks it after genuine system-wide inactivity (confirmed via `chrome.idle.queryState` in the background service worker's own console before and after the wait).

## New ADRs

- [ADR-017](../adr/ADR-017-auto-lock-via-chrome-idle.md) — the `chrome.idle` mechanism choice and why `chrome.alarms` doesn't fit.
- [ADR-018](../adr/ADR-018-settings-module-boundary.md) — the `background/settings/` module-boundary decision, explicit that this is a *code-organization* choice, not a reversal of ADR-001/ADR-007/ADR-009 (local-first, no-server-dependency, personal-project-not-startup).

## Verification

- `pnpm check` after each milestone.
- Unit tests: `background/settings/` handlers (mirroring `background/policy/handler.test.ts`'s own shape), `stores/appSettings.store.ts`, `stores/policies.store.ts`.
- e2e: the Configuration tab's controls and the Personal Data dropdowns don't depend on `activeTab` (same reason Phase 6's own tabs didn't), so they're fully e2e-testable, unlike the popup's per-site sections.
- Manual: real-browser check that auto-lock actually fires (set a short interval, wait, confirm the vault is locked) — the one thing here that can't be faithfully simulated any other way, matching how this project has handled every other MV3/browser-API-dependent behavior so far (service-worker restarts, `activeTab`, WebAuthn).

## Roadmap placement (resolved)

Folded into Phase 7 as "Part A," alongside biometrics as "Part B" — see `docs/roadmap.md`'s own Phase 7 section. No phase renumbering; Phases 8–15 are unaffected.
