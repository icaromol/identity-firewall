import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { usePendingCredentialStore } from '../../../stores/pendingCredential.store';

function mockActiveTab(url = 'https://example.com/login') {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([{ id: 1, url }] as never);
}

describe('usePendingCredentialStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('derives origin from the active tab and loads a pending capture', async () => {
    mockActiveTab();
    const pending = { identifier: 'alice@example.com', password: 'hunter2', capturedAt: 1000 };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: pending,
    } as never);

    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    expect(store.status).toBe('loaded');
    expect(store.origin).toBe('https://example.com');
    expect(store.pending).toEqual(pending);
  });

  it('loads null when nothing is pending', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: null,
    } as never);

    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    expect(store.status).toBe('loaded');
    expect(store.pending).toBeNull();
  });

  it('sets status to error when there is no active tab', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([] as never);

    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    expect(store.status).toBe('error');
  });

  it('confirm() saves the credential and clears pending', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { identifier: 'alice@example.com', password: 'hunter2', capturedAt: 1000 },
    } as never);
    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    const saved = { kind: 'password', username: 'alice@example.com', password: 'hunter2' };
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: saved } as never);

    await store.confirm();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'CONFIRM_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    });
    expect(store.confirming).toBe(false);
    expect(store.pending).toBeNull();
    expect(store.actionError).toBeNull();
  });

  it('confirm() sets actionError on a handler-level failure and leaves pending untouched', async () => {
    mockActiveTab();
    const pending = { identifier: 'alice@example.com', password: 'hunter2', capturedAt: 1000 };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: pending,
    } as never);
    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);
    await store.confirm();

    expect(store.actionError).toBe('boom');
    expect(store.pending).toEqual(pending);
  });

  it('discard() clears the pending capture', async () => {
    mockActiveTab();
    const pending = { identifier: 'alice@example.com', password: 'hunter2', capturedAt: 1000 };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: pending,
    } as never);
    const store = usePendingCredentialStore();
    await store.fetchPendingCredential();

    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: undefined } as never);
    await store.discard();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'DISCARD_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    });
    expect(store.pending).toBeNull();
  });
});
