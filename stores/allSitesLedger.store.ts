// Options-page-side Pinia store for Phase 6 -- the all-sites "Who knows
// what about me" tab. Deliberately separate from stores/privacyLedger.store.ts
// rather than an extra mode on it: that store's whole shape is built around
// resolveActiveTab()-scoping a single origin, and this page has no active-tab
// concept at all (it's a standalone page, not popup-scoped to whatever tab
// is currently focused). Per-origin grouping/aggregation happens in the
// consuming component (entrypoints/options/App.vue), the same way
// entrypoints/popup/App.vue's own ledgerSummary computed aggregates a single
// origin's entries -- this store just fetches the flat list.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type { GetAllPrivacyLedgerMessage, MessageResponse } from '../shared/messages';
import type { PrivacyLedgerEntry } from '../shared/vault-schema';

export interface AllSitesLedgerStoreState {
  entries: PrivacyLedgerEntry[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

export const useAllSitesLedgerStore = defineStore('allSitesLedger', {
  state: (): AllSitesLedgerStoreState => ({
    entries: [],
    status: 'idle',
    error: null,
  }),
  actions: {
    async fetchLedger(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetAllPrivacyLedgerMessage = { type: 'GET_ALL_PRIVACY_LEDGER' };

      try {
        const response: MessageResponse<PrivacyLedgerEntry[]> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.entries = response.data ?? [];
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
