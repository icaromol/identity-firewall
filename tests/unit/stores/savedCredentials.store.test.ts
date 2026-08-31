import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useSavedCredentialsStore } from '../../../stores/savedCredentials.store';

function mockActiveTab(url = 'https://example.com/login') {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([{ id: 1, url }] as never);
}

const passwordCredential = { kind: 'password', username: 'alice@example.com', password: 'hunter2' };

describe('useSavedCredentialsStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('derives origin from the active tab and loads credentials', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: [passwordCredential],
    } as never);

    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    expect(store.status).toBe('loaded');
    expect(store.origin).toBe('https://example.com');
    expect(store.credentials).toEqual([passwordCredential]);
  });

  it('sends GET_CREDENTIAL with the derived origin', async () => {
    mockActiveTab();
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: [] } as never);

    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    });
  });

  it('sets status to error when there is no active tab', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([] as never);

    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    expect(store.status).toBe('error');
  });

  it('fill() sends FILL_CREDENTIAL with the origin, tabId, and chosen credential', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: [passwordCredential],
    } as never);
    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { filled: true } } as never);
    await store.fill(passwordCredential as never);

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'FILL_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1, credential: passwordCredential },
    });
    expect(store.filling).toBeNull();
    expect(store.fillError).toBeNull();
  });

  it('fill() sets fillError when the handler reports filled: false', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: [passwordCredential],
    } as never);
    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { filled: false },
    } as never);
    await store.fill(passwordCredential as never);

    expect(store.fillError).toMatch(/no login form/i);
  });

  it('fill() sets fillError on a handler-level failure', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: [passwordCredential],
    } as never);
    const store = useSavedCredentialsStore();
    await store.fetchCredentials();

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);
    await store.fill(passwordCredential as never);

    expect(store.fillError).toBe('boom');
  });
});
