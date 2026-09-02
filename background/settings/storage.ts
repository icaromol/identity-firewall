// Plain, unencrypted browser.storage.local -- deliberately NOT part of the
// vault's own encrypted/tiered storage (background/vault/storage.ts).
// These are app preferences, not personal/identity data: they must stay
// readable even while the vault is locked (background/settings/
// idleLock.ts's own idle listener needs the configured threshold
// regardless of lock state, and the Configuration tab should show the
// current auto-lock setting even before the vault is ever unlocked).
// See docs/plans/autolock-and-configuration.md's own module-boundary
// decision, confirmed directly with the user: this whole module is
// organized to be extractable later without ever touching vault/
// identity/policy code, which is exactly why this file never imports
// from background/vault/.
//
// No write-queue/transaction here, unlike vault/storage.ts's
// updateVaultIndexWithResult -- settings changes are rare, single-actor,
// user-driven edits from the Configuration tab, not concurrent
// background writes; a plain read-modify-write is a proportionate
// choice for this domain, not an oversight.

import { browser } from 'wxt/browser';
import { type AppSettings, AppSettingsSchema, DEFAULT_APP_SETTINGS } from '../../shared/settings';

const APP_SETTINGS_STORAGE_KEY = 'if_app_settings_v1';

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(APP_SETTINGS_STORAGE_KEY);
  const parsed = AppSettingsSchema.safeParse(stored[APP_SETTINGS_STORAGE_KEY]);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

// Patch-style, matching background/vault/personalData/storage.ts's own
// setPersonalData convention -- an explicit `undefined`-valued key (e.g.
// from a reactive form object) is stripped before merging, treated the
// same as a fully-absent key, so it can never silently overwrite a
// previously-saved value. An explicit `null` (autoLockSeconds: null,
// meaning "never auto-lock") is a real, meaningful patch value and is
// NOT stripped -- only `undefined` is.
export async function setAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  const next = AppSettingsSchema.parse({ ...current, ...cleanPatch });
  await browser.storage.local.set({ [APP_SETTINGS_STORAGE_KEY]: next });
  return next;
}
