import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { usePrivacyLedgerStore } from '../../../stores/privacyLedger.store';

function mockActiveTab(url = 'https://example.com/signup') {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([{ id: 1, url }] as never);
}

describe('usePrivacyLedgerStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('derives origin from the active tab and loads entries on success', async () => {
    mockActiveTab();
    const entries = [
      {
        origin: 'https://example.com',
        at: 1000,
        requestedFields: ['email'],
        disclosedFields: { email: 'real' },
        deniedFields: [],
        authorizationMethod: null,
      },
    ];
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: entries,
    } as never);

    const store = usePrivacyLedgerStore();
    await store.fetchLedger();

    expect(store.status).toBe('loaded');
    expect(store.origin).toBe('https://example.com');
    expect(store.entries).toEqual(entries);
  });

  it('sets status to error when there is no active tab', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([] as never);

    const store = usePrivacyLedgerStore();
    await store.fetchLedger();

    expect(store.status).toBe('error');
  });

  it('sets status to error on a handler-level failure', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = usePrivacyLedgerStore();
    await store.fetchLedger();

    expect(store.status).toBe('error');
    expect(store.error).toBe('boom');
  });

  it('sends GET_PRIVACY_LEDGER with the derived origin', async () => {
    mockActiveTab();
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: [] } as never);

    const store = usePrivacyLedgerStore();
    await store.fetchLedger();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'GET_PRIVACY_LEDGER',
      payload: { origin: 'https://example.com' },
    });
  });
});
