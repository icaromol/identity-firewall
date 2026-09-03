# ADR-017: Auto-lock via `chrome.idle`, not `chrome.alarms`

## Status
Accepted

## Context
Before Phase 7 Part A, the Vault only ever locked when the user explicitly clicked Lock. A device left unattended with the Vault still unlocked from an earlier session stayed unlocked indefinitely — a real gap in `threat-model.md`'s own Attacker D (Device theft) coverage, which is explicitly scoped to "while it is powered off or locked," not this in-between "neither offline nor actively supervised" state.

Two MV3-compatible mechanisms were available for detecting inactivity:

- `chrome.alarms` — clamps to a **1-minute floor** in production (Chrome silently rejects/clamps a shorter `periodInMinutes`), incompatible with the user's own explicit 30-second default request.
- `chrome.idle` — reports `'active' | 'idle' | 'locked'` based on system-wide keyboard/mouse input, with `setDetectionInterval()`'s floor confirmed at **15 seconds** (verified via MDN and Chrome for Developers docs, not assumed) — compatible with a 30-second default and the idiomatic mechanism this exact feature exists for.

## Decision
Use `chrome.idle`, wired in `background/settings/idleLock.ts`:

- `applyDetectionInterval(autoLockSeconds)` calls `chrome.idle.setDetectionInterval()`, clamped to the 15-second floor (`detectionIntervalSecondsFor`). `'Never'` (`autoLockSeconds === null`) is **not** implemented by disabling detection — `chrome.idle` has no such mode — the interval stays at the floor instead, so a later switch back to a real duration takes effect immediately; `handleIdleStateChanged` itself reads the live setting and no-ops for plain `'idle'` when it's `'Never'`.
- `'locked'` (the OS screen actually locking) is a strictly stronger "walked away" signal than mere inactivity and **always** locks the Vault regardless of the configured duration, including `'Never'` — a real bug in an earlier version of this code (caught by `/code-review`'s verification pass) gated `'locked'` on the same null check as `'idle'`, silently defeating this distinction for anyone who chose "Never."
- The listener registers synchronously in `initIdleLock()`'s own first tick, before any `await` — an MV3 service worker only reliably associates an event listener with itself if it's added during the worker's initial synchronous run (confirmed against Chrome's own service-worker-events documentation), not after a pending promise resolves.
- Auto-lock reuses `lockVault()` (`background/vault/unlock.ts`) directly — the exact same one-line `clearCachedUnlockKey()` call `VAULT_LOCK` already uses. No new locking logic anywhere.
- **System-wide idle, not extension-specific activity tracking.** `chrome.idle` fires based on activity anywhere on the computer, not specifically inside this extension's own UI. A stricter, extension-scoped model (tracking "time since last message reached this extension") was considered and rejected: it would lock even while the user is actively browsing other tabs, which doesn't match user expectations set by comparable password-manager extensions (1Password/Bitwarden-style tools) and needs new activity-tracking plumbing this project doesn't otherwise have. Reversible later if the stricter model turns out to be what's actually wanted.

## Consequences
- **Closes the "unattended but unlocked" gap** `threat-model.md` didn't previously name (see that document's own addition alongside this ADR).
- **No new permission cost beyond `'idle'`** — added to `wxt.config.ts`'s manifest; doesn't trigger any Chrome permission warning.
- **The floor is a hard constraint, not a preference.** A user who picks a value below 15 seconds (not offered by the Configuration tab's own dropdown, which starts at 30) would silently get 15 seconds in practice — documented in `shared/settings.ts`'s own schema comment and `MIN_AUTO_LOCK_SECONDS`, not hidden.
- **Detection is system-wide.** Someone else using the same physical device without touching keyboard/mouse (unlikely, but a real edge case for e.g. a screen-share or remote-input scenario) would not trigger `'idle'` — a known, accepted limitation of this mechanism, not a claim this ADR makes otherwise.
