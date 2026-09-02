import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useAllSitesLedgerStore } from '../../../stores/allSitesLedger.store';

describe('useAllSitesLedgerStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('loads entries across every origin on success', async () => {
    const entries = [
      {
        origin: 'https://a.example',
        at: 1000,
        requestedFields: ['email'],
        disclosedFields: { email: 'real' },
        deniedFields: [],
        authorizationMethod: null,
      },
      {
        origin: 'https://b.example',
        at: 2000,
        requestedFields: ['phone'],
        disclosedFields: {},
        deniedFields: ['phone'],
        authorizationMethod: null,
      },
    ];
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: entries,
    } as never);

    const store = useAllSitesLedgerStore();
    await store.fetchLedger();

    expect(store.status).toBe('loaded');
    expect(store.entries).toEqual(entries);
  });

  it('sends GET_ALL_PRIVACY_LEDGER with no payload', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: [] } as never);

    const store = useAllSitesLedgerStore();
    await store.fetchLedger();

    expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'GET_ALL_PRIVACY_LEDGER' });
  });

  it('sets status to error on a handler-level failure', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = useAllSitesLedgerStore();
    await store.fetchLedger();

    expect(store.status).toBe('error');
    expect(store.error).toBe('boom');
  });
});
