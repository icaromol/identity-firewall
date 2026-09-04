import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { reportLog } from '../../../content/log';

describe('reportLog', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('sends RECORD_LOG_ENTRY with the given level/message and a serialized detail', () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce(undefined as never);

    reportLog('info', 'something happened', { formCount: 2 });

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'RECORD_LOG_ENTRY',
      payload: { level: 'info', message: 'something happened', detail: '{"formCount":2}' },
    });
  });

  it('omits detail entirely when none is passed', () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce(undefined as never);

    reportLog('info', 'no detail here');

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'RECORD_LOG_ENTRY',
      payload: { level: 'info', message: 'no detail here', detail: undefined },
    });
  });

  it('never throws even if the transport rejects (fire-and-forget)', () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValueOnce(
      new Error('context invalidated'),
    );

    expect(() => reportLog('error', 'boom')).not.toThrow();
  });
});
