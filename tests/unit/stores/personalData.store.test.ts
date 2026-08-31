import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { usePersonalDataStore } from '../../../stores/personalData.store';

describe('usePersonalDataStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('loads personal data on success', async () => {
    const data = { name: 'Ícaro', email: 'icaro@example.com' };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data,
    } as never);

    const store = usePersonalDataStore();
    await store.fetchPersonalData();

    expect(store.status).toBe('loaded');
    expect(store.data).toEqual(data);
  });

  it('sends GET_PERSONAL_DATA on fetch', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: {} } as never);

    const store = usePersonalDataStore();
    await store.fetchPersonalData();

    expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'GET_PERSONAL_DATA', payload: {} });
  });

  it('sets status to error on a handler-level failure (e.g. a locked vault)', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'VAULT_LOCKED',
    } as never);

    const store = usePersonalDataStore();
    await store.fetchPersonalData();

    expect(store.status).toBe('error');
    expect(store.error).toBe('VAULT_LOCKED');
  });

  it('saves a patch and updates data from the response on success', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { name: 'Ícaro', email: 'icaro@example.com' },
    } as never);

    const store = usePersonalDataStore();
    await store.savePersonalData({ name: 'Ícaro', email: 'icaro@example.com' });

    expect(store.saving).toBe(false);
    expect(store.saveError).toBeNull();
    expect(store.data).toEqual({ name: 'Ícaro', email: 'icaro@example.com' });
  });

  it('sends SET_PERSONAL_DATA with only the given patch', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: {} } as never);

    const store = usePersonalDataStore();
    await store.savePersonalData({ phone: '+55 11 90000-0000' });

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'SET_PERSONAL_DATA',
      payload: { phone: '+55 11 90000-0000' },
    });
  });

  it('sets saveError on a handler-level failure and leaves data untouched', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = usePersonalDataStore();
    await store.savePersonalData({ name: 'Someone' });

    expect(store.saving).toBe(false);
    expect(store.saveError).toBe('boom');
    expect(store.data).toEqual({});
  });
});
