# A standalone "Generate password" button in the popup

**Status:** Complete.
**Roadmap reference:** [`../roadmap.md`](../roadmap.md), Phase 5 ("Vault Completion") ✅ Complete. Phase 5's own objectives already listed "a local password generator (Web Crypto RNG only, ~20 characters)" as delivered, but that only ever meant the primitive existed (`generatePassword()`) — grep confirmed zero call sites anywhere in the UI. This closes that residual gap; it does not reopen or extend Phase 5's scope.

## Context

The user wanted a way to generate a password from the popup itself, independent of any form on the current page — the same kind of general "generate a password" action 1Password/Chrome offer, not only one triggered by focusing a real password field on a page.

**Explicitly out of scope, decided with the user before implementation:** drawing any suggestion UI onto the actual page (a hover icon/dropdown below a detected password field, à la Chrome/1Password). That specific piece is `docs/roadmap.md` Phase 8 ("In-Page Autofill & Auto-Login") territory, which the roadmap sequences after Phase 7 Part B (biometrics, not started) — building it now would be building ahead of the current phase (CLAUDE.md's own standing rule). Left as an open decision for a later session: pull that slice of Phase 8 forward with its own ADR, or wait for the roadmap's existing order.

## Design decisions

- **Moved `passwordGenerator.ts` from `background/vault/credentials/` to `shared/passwordGenerator.ts`.** It's pure (`crypto.getRandomValues` only, no `browser.*` calls) and had zero background consumers, so nothing else needed updating on the background side. This repo's established convention is that `shared/` is the one direction both `background/` and frontend code import from, never the reverse — confirmed via grep that no `entrypoints/` file imported from `background/` before this. Importing it straight into the popup makes generation instant and local, with zero message round-trip, the same way `shared/bytes.ts` is already imported directly by `stores/vault.store.ts`.
- **New store, `stores/passwordGenerator.store.ts`**, same shape as `stores/savedCredentials.store.ts`. `generate()` is synchronous and local. `save()` reuses the existing `SAVE_CREDENTIAL` message as-is — `handleSaveCredential` (`background/vault/credentials/handler.ts`) already creates the `ServiceIdentity` for a brand-new origin idempotently, so saving a password for a site with no prior form/identity needed zero backend changes.
- **Origin input coercion is local to this feature**, not added to `shared/origin.ts`'s `normalizeOrigin` itself (a strict, security-critical primitive used well beyond this one text field): a bare domain typed without a scheme gets `https://` prepended before normalization, since that's the most common way a person would type a site here.
- **UI placement**: inside the popup's existing `vaultReady`-gated section (`entrypoints/popup/App.vue`), not visible when the vault is locked/uninitialized. Generation itself needs no vault access, but saving does, and the popup's own "blocked mode" convention already hides every other site-scoped/sensitive section when locked — a half-working section (generate+copy fine, save broken) would be inconsistent with that. Placed right before "Saved logins" so the natural flow (generate → save → shows up in Saved logins) reads top-to-bottom.
- **Clipboard copy is a new pattern** — no `navigator.clipboard` usage existed anywhere in this codebase before. Wrapped in try/catch with a toast on success/failure; no fallback (e.g. `execCommand`) added preemptively since the popup document has focus at click time, the standard case the Clipboard API supports without extra permissions.
- **Site field prefill** reuses `currentOrigin` (`entrypoints/popup/App.vue`'s existing computed over `firewall.origin`), not a second `resolveActiveTab()` call — every site-scoped store already resolves the active tab independently, so `firewall.origin` is populated in every case any of the others would be too.

## Implementation

- `shared/passwordGenerator.ts` (moved), `tests/unit/shared/passwordGenerator.test.ts` (moved, import path updated).
- `stores/passwordGenerator.store.ts` (new) — `password`/`origin`/`username`/`saving`/`saveError`/`justSaved` state; `generate()`/`save()` actions.
- `tests/unit/stores/passwordGenerator.store.test.ts` (new) — generation, origin coercion (bare domain vs. explicit scheme), null username, malformed-origin error path (no `sendMessage` call), handler-level error.
- `entrypoints/popup/App.vue` — the new "Generate password" `UiSection`, the origin-prefill watcher, and the copy/save click handlers.

## Verification

- `pnpm check` — all new/moved unit tests pass alongside the existing suite.
- No `pnpm test:e2e` (standing user preference).
- Manually verified: generating and copying a password with the vault unlocked, saving it for a freshly-typed origin with no existing form/site, and confirming the whole section disappears when the vault is locked.
