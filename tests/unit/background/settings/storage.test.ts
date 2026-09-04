import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getAppSettings, setAppSettings } from '../../../../background/settings/storage';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings';

describe('app settings storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // Unlike personalData/policy storage, this never touches the vault at
  // all -- confirms the module-boundary decision (docs/plans/autolock-
  // and-configuration.md) actually holds: no vault setup, no unlock, no
  // VaultLockedError path exists for this module at all.
  it('getAppSettings returns the defaults on a totally fresh profile', async () => {
    expect(await getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('setAppSettings round-trips a single field', async () => {
    const result = await setAppSettings({ autoLockSeconds: 60 });
    expect(result).toEqual({ ...DEFAULT_APP_SETTINGS, autoLockSeconds: 60 });
    expect(await getAppSettings()).toEqual({ ...DEFAULT_APP_SETTINGS, autoLockSeconds: 60 });
  });

  it('a second patch preserves fields not included in it', async () => {
    await setAppSettings({ autoLockSeconds: 60 });
    const result = await setAppSettings({ credentialSaveMode: 'auto' });

    expect(result).toEqual({ autoLockSeconds: 60, credentialSaveMode: 'auto', logsEnabled: true });
  });

  it('autoLockSeconds can be explicitly set to null (never auto-lock)', async () => {
    await setAppSettings({ autoLockSeconds: 60 });
    const result = await setAppSettings({ autoLockSeconds: null });

    expect(result.autoLockSeconds).toBeNull();
  });

  it('an explicit undefined-valued key in the patch does not clear an existing field', async () => {
    await setAppSettings({ autoLockSeconds: 60, credentialSaveMode: 'auto' });
    const result = await setAppSettings({ autoLockSeconds: undefined, credentialSaveMode: 'ask' });

    expect(result).toEqual({ autoLockSeconds: 60, credentialSaveMode: 'ask', logsEnabled: true });
  });

  it('falls back to defaults when stored data fails schema validation', async () => {
    await fakeBrowser.storage.local.set({ if_app_settings_v1: { garbage: true } });
    expect(await getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});
