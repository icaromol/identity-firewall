// A bounded, persisted log for local dev testing -- plain
// browser.storage.local (the same backend every other module in this
// codebase already uses; no new library, no IndexedDB, matching the
// user's own explicit "no overengineering" request). Capped at
// MAX_LOG_ENTRIES so this can never grow unbounded against
// storage.local's 10MB quota (no 'unlimitedStorage' permission is
// requested) -- old entries are silently dropped once the cap is hit,
// never an error.

import { browser } from 'wxt/browser';
import type { LogEntry } from '../../shared/messages';
import { createSerialQueue } from '../vault/serialQueue';

const LOG_STORAGE_KEY = 'if_logs_v1';
const MAX_LOG_ENTRIES = 500;

const enqueue = createSerialQueue();

export async function getLogEntries(): Promise<LogEntry[]> {
  const stored = await browser.storage.local.get(LOG_STORAGE_KEY);
  return (stored[LOG_STORAGE_KEY] as LogEntry[] | undefined) ?? [];
}

export function appendLogEntry(entry: LogEntry): Promise<void> {
  return enqueue(async () => {
    const entries = await getLogEntries();
    const next = [...entries, entry].slice(-MAX_LOG_ENTRIES);
    await browser.storage.local.set({ [LOG_STORAGE_KEY]: next });
  });
}

export async function clearLog(): Promise<void> {
  await browser.storage.local.remove(LOG_STORAGE_KEY);
}
