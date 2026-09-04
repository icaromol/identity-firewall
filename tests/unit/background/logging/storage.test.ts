import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { appendLogEntry, clearLog, getLogEntries } from '../../../../background/logging/storage';
import type { LogEntry } from '../../../../shared/messages';

function entry(message: string): LogEntry {
  return { timestamp: Date.now(), level: 'debug', message };
}

describe('logging storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('getLogEntries returns an empty array on a fresh profile', async () => {
    expect(await getLogEntries()).toEqual([]);
  });

  it('appendLogEntry appends in order', async () => {
    await appendLogEntry(entry('first'));
    await appendLogEntry(entry('second'));

    const entries = await getLogEntries();
    expect(entries.map((e) => e.message)).toEqual(['first', 'second']);
  });

  it('trims to the most recent 500 entries once the cap is exceeded', async () => {
    for (let i = 0; i < 505; i++) {
      await appendLogEntry(entry(`entry-${i}`));
    }

    const entries = await getLogEntries();
    expect(entries).toHaveLength(500);
    expect(entries[0]).toMatchObject({ message: 'entry-5' });
    expect(entries[499]).toMatchObject({ message: 'entry-504' });
  });

  it('clearLog removes all entries', async () => {
    await appendLogEntry(entry('first'));
    await clearLog();

    expect(await getLogEntries()).toEqual([]);
  });

  it('concurrent appends do not race -- all entries survive in call order', async () => {
    await Promise.all([
      appendLogEntry(entry('a')),
      appendLogEntry(entry('b')),
      appendLogEntry(entry('c')),
    ]);

    const entries = await getLogEntries();
    expect(entries.map((e) => e.message)).toEqual(['a', 'b', 'c']);
  });
});
