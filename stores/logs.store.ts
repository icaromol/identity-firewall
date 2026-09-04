// Options-page-side Pinia store for the local dev log (background/logging/).
// Same fetch-on-mount shape as stores/appSettings.store.ts. Reading and
// clearing only require the vault to already be unlocked (the Configuration
// tab gates this store's actions behind VaultLockedNotice, same as the
// ledger/Personal Data tabs) -- exporting's extra re-confirmation step is
// the CALLER's responsibility (entrypoints/options/App.vue), not this
// store's: it re-runs vault.unlockWithPassphrase()/unlockWithPasskey() and
// only calls exportLogs() once that succeeds, per docs/plans' "gated by the
// vault" plan.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  ClearLogsMessage,
  ClearLogsResponse,
  GetLogsMessage,
  GetLogsResponse,
  LogEntry,
  MessageResponse,
} from '../shared/messages';

function formatLogLine(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  const head = `[${time}] ${entry.level.toUpperCase()} ${entry.message}`;
  return entry.detail ? `${head}\n${entry.detail}` : head;
}

function downloadLogFile(entries: LogEntry[]): void {
  const text = entries.map(formatLogLine).join('\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `identity-firewall-logs-${Date.now()}.log`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface LogsStoreState {
  entries: LogEntry[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

export const useLogsStore = defineStore('logs', {
  state: (): LogsStoreState => ({
    entries: [],
    status: 'idle',
    error: null,
  }),
  actions: {
    async fetchLogs(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetLogsMessage = { type: 'GET_LOGS', payload: {} };

      try {
        const response: MessageResponse<GetLogsResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.entries = response.data;
          this.status = 'loaded';
        } else {
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },

    async clear(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: ClearLogsMessage = { type: 'CLEAR_LOGS', payload: {} };

      try {
        const response: MessageResponse<ClearLogsResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.entries = [];
          this.status = 'loaded';
        } else {
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },

    // Re-fetches rather than trusting this.entries -- the "Enable logging"
    // toggle or a fresh error since the last successful fetch could mean
    // what's cached in memory is stale or empty; the exported file should
    // reflect what's actually in storage right now.
    async exportLogs(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetLogsMessage = { type: 'GET_LOGS', payload: {} };

      try {
        const response: MessageResponse<GetLogsResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.entries = response.data;
          downloadLogFile(response.data);
          this.status = 'loaded';
        } else {
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },
  },
});
