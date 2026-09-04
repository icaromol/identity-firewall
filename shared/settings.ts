// Phase 7 Part A -- app-wide behavior preferences (auto-lock duration,
// credential save mode). Deliberately its OWN file, not folded into
// vault-schema.ts: these are account/app preferences, not vault or
// identity data -- see docs/plans/autolock-and-configuration.md's own
// module-boundary decision, confirmed directly with the user. The whole
// background/settings/ module built around this schema is organized so
// it could be extracted into its own service later without ever having
// to untangle it from vault/identity/policy code.

import { z } from 'zod';

export const CredentialSaveModeSchema = z.enum(['ask', 'auto']);
export type CredentialSaveMode = z.infer<typeof CredentialSaveModeSchema>;

// chrome.idle.setDetectionInterval's own documented floor (confirmed
// against MDN/Chrome's own API docs, not assumed). Lives here, not in
// background/settings/idleLock.ts, so the one number has exactly one
// definition -- idleLock.ts imports this rather than redefining it.
export const MIN_AUTO_LOCK_SECONDS = 15;

// autoLockSeconds: null means "never auto-lock". A positive integer
// otherwise, clamped to MIN_AUTO_LOCK_SECONDS wherever this value is
// actually applied (background/settings/idleLock.ts), not enforced here
// in the schema -- the schema stays a plain positive-integer-or-null
// contract; the floor is a chrome.idle implementation detail, not a rule
// about what settings data itself is allowed to contain.
// Adding a new required field here means any already-stored AppSettings
// object (from before this field existed) fails validation as a whole --
// background/settings/storage.ts's getAppSettings() falls back to
// DEFAULT_APP_SETTINGS wholesale on any parse failure, so an existing
// local install resets ALL of its settings (auto-lock duration included)
// back to defaults the first time it reads storage after an update like
// this one. Accepted deliberately, matching this project's own "no
// compatibility layers for what's obsolete" engineering principle
// (CLAUDE.md) -- a one-time settings reset on a schema change, not a
// migration system, given this is a personal project with no external
// users yet.
export const AppSettingsSchema = z.object({
  autoLockSeconds: z.number().int().positive().nullable(),
  credentialSaveMode: CredentialSaveModeSchema,
  // Local dev-log toggle (background/logging/) -- defaults to on. Turning
  // it off doesn't silence the underlying console.debug/console.error
  // calls, only whether they're also persisted to browser.storage.local.
  logsEnabled: z.boolean(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// Single source of truth for what the `null` sentinel means -- /code-
// review's verification pass flagged that autoLockSeconds === null was
// being independently re-checked in multiple places across
// background/settings/idleLock.ts (once to decide the chrome.idle
// interval, once to decide whether to actually lock), which is exactly
// the shape of bug that already shipped once here (see idleLock.ts's own
// comment on the 'locked'-vs-'idle' fix): a scattered sentinel check is
// easy to place in a spot where it silently changes the wrong behavior.
// Callers that mean "should locking ever happen at all" should use this,
// not repeat the `=== null` check themselves.
export function isAutoLockDisabled(autoLockSeconds: number | null): autoLockSeconds is null {
  return autoLockSeconds === null;
}

// 30 seconds, per the user's own explicit default request.
export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoLockSeconds: 30,
  credentialSaveMode: 'ask',
  logsEnabled: true,
};
