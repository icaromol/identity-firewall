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

// autoLockSeconds: null means "never auto-lock". A positive integer
// otherwise -- chrome.idle.setDetectionInterval's own documented floor is
// 15 seconds (confirmed against MDN/Chrome's own API docs, not assumed),
// clamped to that floor wherever this value is actually applied
// (background/settings/idleLock.ts), not enforced here in the schema --
// the schema stays a plain positive-integer-or-null contract; the floor
// is a chrome.idle implementation detail, not a rule about what settings
// data itself is allowed to contain.
export const AppSettingsSchema = z.object({
  autoLockSeconds: z.number().int().positive().nullable(),
  credentialSaveMode: CredentialSaveModeSchema,
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// 30 seconds, per the user's own explicit default request.
export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoLockSeconds: 30,
  credentialSaveMode: 'ask',
};
