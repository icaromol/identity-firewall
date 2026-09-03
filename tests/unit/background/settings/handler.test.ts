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

  // Regression test for the exact race /code-review's verification pass
  // found and setAppSettings's afterWrite parameter exists to close: a
  // slow autoLockSeconds save's own chrome.idle call must not let a
  // faster, unrelated concurrent save's response resolve first and then
  // get silently overwritten by the slow call's now-stale `next` in the
  // Pinia store. Confirms request order is preserved end to end, not just
  // that the final persisted value happens to be correct.
  it('resolves two overlapping SET_APP_SETTINGS calls in request order, not settle order', async () => {
    let resolveSlowInterval: () => void = () => {};
    const slowInterval = new Promise<void>((resolve) => {
      resolveSlowInterval = resolve;
    });
    vi.spyOn(fakeBrowser.idle, 'setDetectionInterval').mockImplementation((seconds) =>
      seconds === 3600 ? slowInterval : Promise.resolve(undefined),
    );

    const order: string[] = [];
    const callA = handleSetAppSettings({
      type: 'SET_APP_SETTINGS',
      payload: { autoLockSeconds: 3600 },
    }).then((result) => {
      order.push('A');
      return result;
    });
    const callB = handleSetAppSettings({
      type: 'SET_APP_SETTINGS',
      payload: { credentialSaveMode: 'auto' },
    }).then((result) => {
      order.push('B');
      return result;
    });

    // B is queued behind A's whole write-then-chrome.idle task -- it
    // cannot resolve while A's own chrome.idle call is still pending,
    // regardless of how much faster B's own write would otherwise be.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    resolveSlowInterval();
    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(order).toEqual(['A', 'B']);
    expect(resultA.autoLockSeconds).toBe(3600);
    // B's response reflects BOTH changes -- it read A's already-committed
    // write, and nothing lets A's stale `next` clobber it afterward.
    expect(resultB).toEqual({ autoLockSeconds: 3600, credentialSaveMode: 'auto' });
  });
});
