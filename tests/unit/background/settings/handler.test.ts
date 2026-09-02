import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleGetAppSettings,
  handleSetAppSettings,
} from '../../../../background/settings/handler';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings';

describe('app settings handlers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('handleGetAppSettings returns the defaults before any set', async () => {
    const result = await handleGetAppSettings({ type: 'GET_APP_SETTINGS', payload: {} });
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('handleSetAppSettings round-trips a patch through handleGetAppSettings', async () => {
    await handleSetAppSettings({
      type: 'SET_APP_SETTINGS',
      payload: { autoLockSeconds: 300 },
    });

    const result = await handleGetAppSettings({ type: 'GET_APP_SETTINGS', payload: {} });
    expect(result).toEqual({ ...DEFAULT_APP_SETTINGS, autoLockSeconds: 300 });
  });
});
