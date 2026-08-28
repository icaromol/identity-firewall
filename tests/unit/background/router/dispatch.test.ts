import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleRuntimeMessage } from '../../../../background/router/dispatch';
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

  it('replies NOT_IMPLEMENTED synchronously for a schema-valid type with no registered handler', () => {
    const responses: MessageResponse[] = [];
    const keepChannelOpen = handleRuntimeMessage(
      { type: 'VAULT_STATUS' },
      {} as never,
      (response) => responses.push(response),
    );

    expect(keepChannelOpen).toBe(false);
    expect(responses).toEqual([{ ok: false, error: 'NOT_IMPLEMENTED' }]);
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
