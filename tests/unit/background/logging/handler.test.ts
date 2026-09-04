import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleClearLogs, handleGetLogs, log } from '../../../../background/logging/handler';
import { setAppSettings } from '../../../../background/settings/storage';

describe('logging handler', () => {
  beforeEach(() => {
    fakeBrowser.reset();
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

  it('does not persist when logsEnabled is false, but still logs to console', async () => {
    await setAppSettings({ logsEnabled: false });
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    log('debug', 'should not persist');
    // Give the fire-and-forget persistLogEntry a tick to run (it would be
    // a no-op regardless, but this confirms it isn't merely slow).
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith('should not persist', undefined);
    expect(await handleGetLogs({ type: 'GET_LOGS', payload: {} })).toEqual([]);
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
});
