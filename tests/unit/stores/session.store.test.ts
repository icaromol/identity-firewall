import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useSessionStore } from '../../../stores/session.store';

describe('useSessionStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('populates originsWithForms and sets status to loaded on a successful response', async () => {
    // `as never`: fakeBrowser.runtime.sendMessage's overloaded signature
    // (inherited from chrome.runtime.sendMessage's classic callback-style
    // overload set) makes vi.spyOn infer a `void`-returning overload here,
    // unlike the single-signature methods (e.g. storage.session.get) the
    // rest of this codebase's tests mock -- this is purely a test-file
    // typing workaround, unrelated to and not affecting the store's own
    // production typing (which goes through wxt/browser's `browser`, a
    // separately-typed wrapper).
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: {
        originsWithForms: [{ origin: 'https://example.com', formCount: 1, lastDetectedAt: 1000 }],
      },
    } as never);

    const store = useSessionStore();
    await store.fetchSessionState();

    expect(store.status).toBe('loaded');
    expect(store.error).toBeNull();
    expect(store.originsWithForms).toEqual([
      { origin: 'https://example.com', formCount: 1, lastDetectedAt: 1000 },
    ]);
  });

  it('sets status to error and captures the message on a handler-level failure', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = useSessionStore();
    await store.fetchSessionState();

    expect(store.status).toBe('error');
    expect(store.error).toBe('boom');
    expect(store.originsWithForms).toEqual([]);
  });

  it('sets status to error when the transport itself rejects', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValueOnce(
      new Error('Extension context invalidated.'),
    );

    const store = useSessionStore();
    await store.fetchSessionState();

    expect(store.status).toBe('error');
    expect(store.error).toBe('Extension context invalidated.');
  });

  it('sends a bare GET_SESSION_STATE message with no payload key', async () => {
    const sendMessage = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { originsWithForms: [] } } as never);

    const store = useSessionStore();
    await store.fetchSessionState();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SESSION_STATE' });
  });
});
