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
// Read-modify-write is still serialized through the same
// createSerialQueue() primitive vault/storage.ts's own write paths use
// (/code-review, verification pass -- the popup and the Options page can
// both be open at once, and the Configuration tab's own controls can fire
// two SET_APP_SETTINGS calls back-to-back, so "settings writes are rare
// and single-actor" doesn't actually hold; without this, the second of
// two concurrent setAppSettings calls would read the same stale `current`
// and silently clobber the first patch on write).

import { browser } from 'wxt/browser';
import { type AppSettings, AppSettingsSchema, DEFAULT_APP_SETTINGS } from '../../shared/settings';
import { createSerialQueue } from '../vault/serialQueue';

const APP_SETTINGS_STORAGE_KEY = 'if_app_settings_v1';

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(APP_SETTINGS_STORAGE_KEY);
  const parsed = AppSettingsSchema.safeParse(stored[APP_SETTINGS_STORAGE_KEY]);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

const enqueue = createSerialQueue();

// Patch-style, matching background/vault/personalData/storage.ts's own
// setPersonalData convention -- an explicit `undefined`-valued key (e.g.
// from a reactive form object) is stripped before merging, treated the
// same as a fully-absent key, so it can never silently overwrite a
// previously-saved value. An explicit `null` (autoLockSeconds: null,
// meaning "never auto-lock") is a real, meaningful patch value and is
// NOT stripped -- only `undefined` is.
export function setAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return enqueue(async () => {
    const current = await getAppSettings();
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const next = AppSettingsSchema.parse({ ...current, ...cleanPatch });
    await browser.storage.local.set({ [APP_SETTINGS_STORAGE_KEY]: next });
    return next;
  });
}
