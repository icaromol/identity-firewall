import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleRuntimeMessage } from '../../../../background/router/dispatch';
import { registry } from '../../../../background/router/registry';
import type { MessageResponse } from '../../../../shared/messages';

// See docs/research/attestto-teardown.md §7/§8.3 for the shipped bug this
// guarantee fixes: a handler that threw could leave a caller waiting for a
// reply that would never come.

describe('handleRuntimeMessage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('routes a valid message to its handler and replies exactly once', async () => {
    const responses: MessageResponse[] = [];
    const keepChannelOpen = handleRuntimeMessage(
      { type: 'GET_SESSION_STATE' },
      {} as never,
      (response) => responses.push(response),
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual({ ok: true, data: { originsWithForms: [] } });
  });

  it('rejects an invalid raw message synchronously, without reaching any handler', () => {
    const responses: MessageResponse[] = [];
    const keepChannelOpen = handleRuntimeMessage(
      { type: 'NOT_A_REAL_TYPE' },
      {} as never,
      (response) => responses.push(response),
    );

    expect(keepChannelOpen).toBe(false);
    expect(responses).toEqual([{ ok: false, error: 'INVALID_MESSAGE' }]);
  });

  describe('when a schema-valid type has no registered handler', () => {
    // As of M7, all 16 message types in ExtensionMessageSchema have a real
    // registered handler -- there is no "still unregistered" example left
    // to point at (this test's example moved three times before this:
    // VAULT_STATUS -> GET_SERVICE_IDENTITY -> GET_PERSONAL_DATA ->
    // EXPORT_VAULT_BACKUP, each time because the next milestone gave the
    // previous example a real handler). Rather than patch this a fourth
    // time, the missing-handler condition is now simulated directly against
    // the registry, so this test never needs editing again as new message
    // types get real handlers. GET_SESSION_STATE is deleted from `registry`
    // for the duration of one test (it's a plain, non-frozen object, so
    // `delete` both type-checks and works at runtime), then restored --
    // both in a `finally` (the primary mechanism) and in `afterEach` as
    // defense-in-depth against a future refactor that drops the
    // try/finally.
    const originalEntry = registry.GET_SESSION_STATE;

    afterEach(() => {
      registry.GET_SESSION_STATE = originalEntry;
    });

    it('replies NOT_IMPLEMENTED synchronously', () => {
      delete registry.GET_SESSION_STATE;

      try {
        const responses: MessageResponse[] = [];
        const keepChannelOpen = handleRuntimeMessage(
          { type: 'GET_SESSION_STATE' },
          {} as never,
          (response) => responses.push(response),
        );

        expect(keepChannelOpen).toBe(false);
        expect(responses).toEqual([{ ok: false, error: 'NOT_IMPLEMENTED' }]);
      } finally {
        registry.GET_SESSION_STATE = originalEntry;
      }
    });
  });

  it('produces exactly one error response when the handler throws, never zero and never two', async () => {
    vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValueOnce(new Error('boom'));

    const responses: MessageResponse[] = [];
    handleRuntimeMessage(
      { type: 'GET_ORIGIN_STATE', payload: { origin: 'https://example.com' } },
      {} as never,
      (response) => responses.push(response),
    );

    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toEqual({ ok: false, error: 'boom' });
  });
});
