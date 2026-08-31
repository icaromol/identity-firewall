// Popup-side Pinia store for Phase 4 M5 -- "what does this site know
// about me?" (privacy-model.md). Mirrors firewall.store.ts's own
// active-tab-origin pattern rather than reading firewall.store.ts's
// already-fetched origin -- each store independently fetches what it
// needs on mount, matching session.store.ts/vault.store.ts's established
// convention of self-contained, independently-testable stores.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type { GetPrivacyLedgerMessage, MessageResponse } from '../shared/messages';
import type { PrivacyLedgerEntry } from '../shared/vault-schema';
import { resolveActiveTab } from './shared/activeTab';

export interface PrivacyLedgerStoreState {
  origin: string | null;
  entries: PrivacyLedgerEntry[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

export const usePrivacyLedgerStore = defineStore('privacyLedger', {
  state: (): PrivacyLedgerStoreState => ({
    origin: null,
    entries: [],
    status: 'idle',
    error: null,
  }),
  actions: {
    async fetchLedger(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const { origin } = await resolveActiveTab();
        this.origin = origin;

        const message: GetPrivacyLedgerMessage = {
          type: 'GET_PRIVACY_LEDGER',
          payload: { origin: this.origin },
        };
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
