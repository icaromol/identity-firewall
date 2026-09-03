// Plain, unencrypted browser.storage.local -- deliberately NOT part of the
// vault's own encrypted/tiered storage (background/vault/storage.ts).
// These are app preferences, not personal/identity data: they must stay
// readable even while the vault is locked (background/settings/
// idleLock.ts's own idle listener needs the configured threshold
// regardless of lock state, and the Configuration tab should show the
// current auto-lock setting even before the vault is ever unlocked).
// See docs/plans/autolock-and-configuration.md's own module-boundary
// decision, confirmed directly with the user: this module owns its own
// storage namespace and never reaches into the vault's tiered/encrypted
// storage or its identity/policy business logic. It does import two
// narrow, generic-utility things from background/vault/ (this file's own
// createSerialQueue() below, and idleLock.ts's lockVault()) -- deliberate,
// bounded dependencies, not a reversal of the boundary: createSerialQueue
// has zero vault-specific logic (it just happens to live under vault/,
// where it was first extracted from), and lockVault() is the one call
// *into* another module the plan itself calls out, never the reverse.
// /code-review caught an earlier version of this comment claiming "never
// imports from background/vault/" outright, which the code directly
// beneath it already contradicted.
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
import { stripUndefinedValues } from '../../shared/patch';
import { type AppSettings, AppSettingsSchema, DEFAULT_APP_SETTINGS } from '../../shared/settings';
import { createSerialQueue } from '../vault/serialQueue';

const APP_SETTINGS_STORAGE_KEY = 'if_app_settings_v1';

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(APP_SETTINGS_STORAGE_KEY);
  const parsed = AppSettingsSchema.safeParse(stored[APP_SETTINGS_STORAGE_KEY]);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

const enqueue = createSerialQueue();

const noopAfterWrite = async (): Promise<void> => {};

// Patch-style, matching background/vault/personalData/storage.ts's own
// setPersonalData convention -- see stripUndefinedValues's own comment
// for why an explicit `undefined`-valued key is stripped before merging.
// An explicit `null` (autoLockSeconds: null, meaning "never auto-lock")
// is a real, meaningful patch value and is NOT stripped -- only
// `undefined` is.
//
// `afterWrite`, if given, runs *inside* the same enqueued task as the
// write itself, before the next queued call can start -- for a caller
// (background/settings/handler.ts) that needs a side effect (re-applying
// chrome.idle's detection interval) resolved in the same order as the
// write that produced its input. /code-review's verification pass found
// that two overlapping SET_APP_SETTINGS calls -- correctly serialized for
// the write itself -- could still apply their own follow-up chrome.idle
// calls out of order relative to each other (whichever settles last wins,
// regardless of which call's write was actually the most recent), and
// could resolve their handler responses out of order too, letting a
// slower call's stale `next` overwrite a faster call's newer one in the
// Pinia store. The trade-off this buys: `afterWrite` now sits in the same
// queue slot as the write, so a slow or hung `afterWrite` (e.g. a stalled
// chrome.idle call) blocks a *different, unrelated* SET_APP_SETTINGS call
// from persisting until it settles -- accepted here since
// setDetectionInterval is a fast native binding, not real I/O, and the
// ordering bug it fixes was the more likely failure of the two.
export function setAppSettings(
  patch: Partial<AppSettings>,
  afterWrite: (next: AppSettings) => Promise<unknown> = noopAfterWrite,
): Promise<AppSettings> {
  return enqueue(async () => {
    const current = await getAppSettings();
    const cleanPatch = stripUndefinedValues(patch);
    const next = AppSettingsSchema.parse({ ...current, ...cleanPatch });
    await browser.storage.local.set({ [APP_SETTINGS_STORAGE_KEY]: next });
    await afterWrite(next);
    return next;
  });
}
