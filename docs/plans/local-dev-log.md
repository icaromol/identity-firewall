# A local, vault-gated dev log

**Status:** Complete.
**Roadmap reference:** None. This is developer/debugging tooling requested directly by the user, not tied to any `docs/roadmap.md` phase objective — recorded here (rather than left undocumented) so it isn't mistaken for missing scope from an existing phase.
**ADR:** [`../adr/ADR-019-local-log-gated-by-vault-auth.md`](../adr/ADR-019-local-log-gated-by-vault-auth.md) covers the access-control design decision in full; this doc covers the rest of the implementation.

## Context

Running the extension locally surfaced a need for a persisted record of internal errors/debug events (e.g. what actually happened around a failed background operation) without opening a devtools console at the exact right moment. The user asked for: an on/off toggle (default on), some access control since the content could be worth protecting, and an extra re-confirmation step specifically before exporting the log file to disk. See ADR-019 for why access control ended up reusing the vault's own authentication instead of a bespoke password scheme.

## Design decisions

- **On/off toggle**: `AppSettings.logsEnabled: boolean`, default `true` (`shared/settings.ts`) — exactly like the existing `autoLockSeconds`/`credentialSaveMode` fields. Adding this required field means any already-stored `AppSettings` blob predating it fails schema validation as a whole and falls back to `DEFAULT_APP_SETTINGS` — a one-time settings reset accepted deliberately (CLAUDE.md's "no compatibility layers for what's obsolete"), not a migration system, since this is a personal project with no external users yet.
- **Viewing** is gated by `VaultLockedNotice` inside the Configuration tab's own "Logs" card (not the whole tab — the rest of Configuration stays usable while locked, per ADR-018).
- **Clearing** only needs the vault unlocked (no extra re-confirmation — it deletes data, it doesn't expose it).
- **Exporting** re-confirms via an inline passphrase/passkey form before the actual file download runs (ADR-019).
- **Export format**: plain, human-readable text (one entry per line: timestamp, level, message, detail) — a debug log meant to be read directly, not a data-interchange format. Filename: `identity-firewall-logs-<timestamp>.log`.
- **Storage**: capped ring buffer, 500 entries, plain `browser.storage.local` (key `if_logs_v1`) — no IndexedDB, no new library, matching the user's own explicit "no overengineering" request and this codebase's own convention that every same-sized concern under `background/` splits into `storage.ts` + `handler.ts`.
- **The Logs card shows the actual entries live**, not just a count — a scrollable, newest-first list (capped to the most recent 100 rendered, well below the 500-entry backend cap, to keep DOM size cheap in a perpetually-open Options tab), colored by level using `theme.css`'s own `if-tangerine` (error) and `if-lagoon` (debug) accents rather than Tailwind's generic `red-600` — this project's established palette, not an ad hoc color choice. "Live" is `browser.storage.onChanged` (first use of this API anywhere in the codebase): the Options page listens for any `'local'`-area storage change and refetches `GET_LOGS`, rather than a new dedicated `LOGS_CHANGED` message — deliberately not filtered to the log's own storage key, since that key is a background-private implementation detail (ADR-019) this component has no reason to duplicate, and refetching on any local-storage write is cheap enough not to need that precision.

## Known limitation

`wxt/testing/fake-browser` does not implement/fire `storage.onChanged` (confirmed by inspecting its source — no matches for `onChanged` anywhere in the package), so the live-update wiring itself has no unit-test coverage and relies on manual verification only. Matches this codebase's existing precedent for fake-browser gaps (`chrome.idle` is the other one, called out in `autolock-and-configuration.md`).

## Implementation

- `background/logging/storage.ts` — `getLogEntries()`/`appendLogEntry()`/`clearLog()`, guarded by `createSerialQueue()` (`background/vault/serialQueue.ts`) for race-free appends.
- `background/logging/handler.ts` — `log(level, message, detail?)`, the one function the rest of `background/` calls instead of a bare `console.debug`/`console.error`: unchanged console output, plus a fire-and-forget, never-throwing persist gated on `logsEnabled`. Also `handleGetLogs`/`handleClearLogs`.
- `shared/messages.ts` — `LogLevel`/`LogEntry` types, `GET_LOGS`/`CLEAR_LOGS` message schemas.
- `background/router/registry.ts` — new `'logging'` capability.
- Retrofitted 5 existing `console.debug`/`console.error` call sites to route through `log()`: `background/badge.ts`, `background/vault/credentials/autoSaveNotice.ts`, `background/settings/handler.ts`, `background/settings/idleLock.ts` (×2).
- `stores/logs.store.ts` — `fetchLogs()`/`clear()`/`exportLogs()`, mirroring `stores/appSettings.store.ts`'s shape; `exportLogs()` adapts `stores/vault.store.ts`'s `downloadBackupBundle` Blob/anchor-click pattern for plain text instead of JSON.
- `entrypoints/options/App.vue`'s Configuration tab — an "Enable logging" toggle card, and a "Logs" card (currently laid out as a secondary right-hand column alongside the other Configuration cards) with the `VaultLockedNotice` gate, entry-count summary, the live palette-colored entry list, Clear button, and the Download-with-re-confirmation flow.

## Verification

- `pnpm check` — unit tests for `background/logging/storage.ts` (append/trim-at-500/clear/concurrent-append ordering) and `background/logging/handler.ts` (console passthrough, `logsEnabled` respected, never throws on a storage failure, `Error` details serialize to their stack/message).
- No `pnpm test:e2e` (standing user preference — e2e is run manually).
- Manually verified: toggling logging off/on, triggering a real failure path (Firefox's benign `browser.action`-vs-`browser.browserAction` badge error), unlocking the vault and seeing a real entry count, downloading a real `.log` file via the re-confirmation form, and watching the entry list update live (no manual refresh) while a real failure path fired repeatedly with the Configuration tab already open.
