import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings';
import { useAppSettingsStore } from '../../../stores/appSettings.store';

describe('useAppSettingsStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('loads app settings on success', async () => {
    const data = { ...DEFAULT_APP_SETTINGS, autoLockSeconds: 900 };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data,
    } as never);

    const store = useAppSettingsStore();
    await store.fetchAppSettings();

    expect(store.status).toBe('loaded');
    expect(store.data).toEqual(data);
  });

  it('sends GET_APP_SETTINGS on fetch', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: DEFAULT_APP_SETTINGS } as never);

    const store = useAppSettingsStore();
    await store.fetchAppSettings();

    expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'GET_APP_SETTINGS', payload: {} });
  });

  it('sets status to error on a handler-level failure', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = useAppSettingsStore();
    await store.fetchAppSettings();

    expect(store.status).toBe('error');
    expect(store.error).toBe('boom');
  });

  it('saves a patch and updates data from the response on success', async () => {
    const data = { ...DEFAULT_APP_SETTINGS, credentialSaveMode: 'auto' as const };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data,
    } as never);

    const store = useAppSettingsStore();
    await store.saveAppSettings({ credentialSaveMode: 'auto' });

    expect(store.saving).toBe(false);
    expect(store.saveError).toBeNull();
    expect(store.data).toEqual(data);
    expect(store.justSaved).toBe(true);
  });

  it('sends SET_APP_SETTINGS with only the given patch', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: DEFAULT_APP_SETTINGS } as never);

    const store = useAppSettingsStore();
    await store.saveAppSettings({ autoLockSeconds: 60 });

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'SET_APP_SETTINGS',
      payload: { autoLockSeconds: 60 },
    });
  });

  it('sets saveError on a handler-level failure and leaves data untouched', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = useAppSettingsStore();
    await store.saveAppSettings({ autoLockSeconds: 60 });

    expect(store.saving).toBe(false);
    expect(store.saveError).toBe('boom');
    expect(store.data).toEqual(DEFAULT_APP_SETTINGS);
    expect(store.justSaved).toBe(false);
  });

  it('clears a previous justSaved at the start of a new save attempt', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: DEFAULT_APP_SETTINGS,
    } as never);
    const store = useAppSettingsStore();
    await store.saveAppSettings({ autoLockSeconds: 60 });
    expect(store.justSaved).toBe(true);

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);
    await store.saveAppSettings({ autoLockSeconds: 120 });
    expect(store.justSaved).toBe(false);
  });
});
