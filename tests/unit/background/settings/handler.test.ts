import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleGetAppSettings,
  handleSetAppSettings,
} from '../../../../background/settings/handler';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings';

describe('app settings handlers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // fake-browser doesn't implement chrome.idle at all (throws
    // MockNotImplementedError on any call) -- handleSetAppSettings calls
    // applyDetectionInterval as a side effect, so this needs stubbing
    // even though this test file isn't about idle detection itself.
    vi.spyOn(fakeBrowser.idle, 'setDetectionInterval').mockReset().mockResolvedValue(undefined);
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

  // /code-review (angles: altitude, reuse, efficiency, simplification, and
  // the removed-behavior auditor all independently converged on this) --
  // re-applying the chrome.idle interval on every save, even ones that
  // never touched autoLockSeconds, was both wasted work and an unrelated
  // new failure dependency for e.g. the credential-save-mode control.
  it('does not touch chrome.idle when the patch never mentions autoLockSeconds', async () => {
    const intervalSpy = vi.spyOn(fakeBrowser.idle, 'setDetectionInterval');

    await handleSetAppSettings({
      type: 'SET_APP_SETTINGS',
      payload: { credentialSaveMode: 'auto' },
    });

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  // A transient chrome.idle failure must not turn an already-persisted,
  // already-successful settings write into a reported save failure --
  // that would leave the UI showing a stale value/error while storage
  // already has the new one (the exact divergence the cross-file-tracer
  // and removed-behavior-auditor angles both flagged).
  it('still returns the persisted settings if applying the new interval throws', async () => {
    vi.spyOn(fakeBrowser.idle, 'setDetectionInterval').mockRejectedValueOnce(
      new Error('chrome.idle unavailable'),
    );

    const result = await handleSetAppSettings({
      type: 'SET_APP_SETTINGS',
      payload: { autoLockSeconds: 120 },
    });

    expect(result).toEqual({ ...DEFAULT_APP_SETTINGS, autoLockSeconds: 120 });
    expect(await handleGetAppSettings({ type: 'GET_APP_SETTINGS', payload: {} })).toEqual(result);
  });
});
