import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleClearLogs,
  handleGetLogs,
  handleRecordLogEntry,
  log,
} from '../../../../background/logging/handler';
import { setAppSettings } from '../../../../background/settings/storage';

describe('logging handler', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('log() still calls the real console method with the original arguments', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    log('debug', 'hello', { detail: 1 });

    expect(spy).toHaveBeenCalledWith('hello', { detail: 1 });
  });

  it('persists an entry that GET_LOGS then returns', async () => {
    log('error', 'something failed');
    await vi.waitFor(async () => {
      const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
      expect(entries).toHaveLength(1);
    });

    const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
    expect(entries[0]).toMatchObject({ level: 'error', message: 'something failed' });
  });

  it('serializes an Error detail to its stack/message, not [object Object]', async () => {
    log('error', 'boom', new Error('bad input'));
    await vi.waitFor(async () => {
      const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
      expect(entries).toHaveLength(1);
    });

    const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
    expect(entries[0]?.detail).toContain('bad input');
  });

  it('logLevel "off" persists nothing, including error-tagged entries, but still consoles', async () => {
    await setAppSettings({ logLevel: 'off' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    log('error', 'should not persist even though it is an error');
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith('should not persist even though it is an error', undefined);
    expect(await handleGetLogs({ type: 'GET_LOGS', payload: {} })).toEqual([]);
  });

  it('logLevel "info" persists info/error entries but skips debug-tagged ones', async () => {
    await setAppSettings({ logLevel: 'info' });

    log('debug', 'skipped');
    log('info', 'kept-info');
    log('error', 'kept-error');
    await vi.waitFor(async () => {
      const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
      expect(entries).toHaveLength(2);
    });

    const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
    expect(entries.map((e) => e.message)).toEqual(['kept-info', 'kept-error']);
  });

  it('logLevel "debug" persists every level', async () => {
    await setAppSettings({ logLevel: 'debug' });

    log('debug', 'a');
    log('info', 'b');
    log('error', 'c');
    await vi.waitFor(async () => {
      expect(await handleGetLogs({ type: 'GET_LOGS', payload: {} })).toHaveLength(3);
    });
  });

  it('never throws even when the underlying storage write fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));

    expect(() => log('error', 'still safe')).not.toThrow();
  });

  it('handleClearLogs empties the log', async () => {
    log('debug', 'to be cleared');
    await vi.waitFor(async () => {
      expect(await handleGetLogs({ type: 'GET_LOGS', payload: {} })).toHaveLength(1);
    });

    await handleClearLogs({ type: 'CLEAR_LOGS', payload: {} });
    expect(await handleGetLogs({ type: 'GET_LOGS', payload: {} })).toEqual([]);
  });

  it('handleRecordLogEntry persists a content-script report without also consoling', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await handleRecordLogEntry({
      type: 'RECORD_LOG_ENTRY',
      payload: { level: 'info', message: 'content script event', detail: 'some detail' },
    });

    const entries = await handleGetLogs({ type: 'GET_LOGS', payload: {} });
    expect(entries).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'content script event',
        detail: 'some detail',
      }),
    ]);
    // The content script already consoles its own message directly (a
    // separate console from the background service worker's) -- this
    // handler must never console a second time.
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
