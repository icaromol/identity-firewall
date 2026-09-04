import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { usePasswordGeneratorStore } from '../../../stores/passwordGenerator.store';

describe('usePasswordGeneratorStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
    // vi.spyOn on an already-mocked method doesn't reset its call history on
    // its own -- needed for the 'not.toHaveBeenCalled()' assertion below to
    // reflect only calls made within its own test (same fix as
    // firewall.store.test.ts's own beforeEach).
    vi.restoreAllMocks();
  });

  it('generate() fills password with a real 20-char value and resets save state', () => {
    const store = usePasswordGeneratorStore();
    store.saveError = 'stale error';
    store.justSaved = true;

    store.generate();

    expect(store.password).toHaveLength(20);
    expect(store.saveError).toBeNull();
    expect(store.justSaved).toBe(false);
  });

  it('generate() produces a different password each call', () => {
    const store = usePasswordGeneratorStore();
    store.generate();
    const first = store.password;
    store.generate();

    expect(store.password).not.toBe(first);
  });

  it('save() prepends https:// to a bare domain before sending SAVE_CREDENTIAL', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { kind: 'password' } } as never);

    const store = usePasswordGeneratorStore();
    store.password = 'generated-pw';
    store.origin = 'example.com';
    store.username = 'alice';

    await store.save();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'SAVE_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        credential: { kind: 'password', username: 'alice', password: 'generated-pw' },
      },
    });
    expect(store.justSaved).toBe(true);
    expect(store.saveError).toBeNull();
  });

  it('save() leaves an explicit scheme untouched', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { kind: 'password' } } as never);

    const store = usePasswordGeneratorStore();
    store.password = 'generated-pw';
    store.origin = 'http://localhost:5173';

    await store.save();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ origin: 'http://localhost:5173' }),
      }),
    );
  });

  it('save() sends null username when none was typed', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { kind: 'password' } } as never);

    const store = usePasswordGeneratorStore();
    store.password = 'generated-pw';
    store.origin = 'example.com';

    await store.save();

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          credential: expect.objectContaining({ username: null }),
        }),
      }),
    );
  });

  it('save() sets saveError on a malformed origin, without calling sendMessage', async () => {
    const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage');

    const store = usePasswordGeneratorStore();
    store.password = 'generated-pw';
    store.origin = 'not a url at all::::';

    await store.save();

    expect(store.saveError).not.toBeNull();
    expect(store.justSaved).toBe(false);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('save() sets saveError on a handler-level failure', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'VAULT_LOCKED',
    } as never);

    const store = usePasswordGeneratorStore();
    store.password = 'generated-pw';
    store.origin = 'example.com';

    await store.save();

    expect(store.saveError).toBe('VAULT_LOCKED');
    expect(store.justSaved).toBe(false);
  });
});
