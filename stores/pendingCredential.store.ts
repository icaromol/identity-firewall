// Popup-side Pinia store for Phase 5 M4 -- "save this login?" Mirrors
// firewall.store.ts's active-tab-origin resolution (this is per-site, like
// the pending firewall request, not a single vault-wide blob the way
// personalData.store.ts is).

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  ConfirmPendingCredentialMessage,
  DiscardPendingCredentialMessage,
  GetPendingCredentialMessage,
  MessageResponse,
  PendingCredential,
} from '../shared/messages';
import type { CredentialRecord } from '../shared/vault-schema';

export interface PendingCredentialStoreState {
  origin: string | null;
  tabId: number | null;
  pending: PendingCredential | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  confirming: boolean;
  discarding: boolean;
  actionError: string | null;
  // The just-saved record, shown briefly after a successful confirm --
  // cleared again on the next fetch.
  savedCredential: CredentialRecord | null;
}

export const usePendingCredentialStore = defineStore('pendingCredential', {
  state: (): PendingCredentialStoreState => ({
    origin: null,
    tabId: null,
    pending: null,
    status: 'idle',
    error: null,
    confirming: false,
    discarding: false,
    actionError: null,
    savedCredential: null,
  }),
  actions: {
    async fetchPendingCredential(): Promise<void> {
      this.status = 'loading';
      this.error = null;
      this.actionError = null;
      this.savedCredential = null;

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url || tab.id === undefined) {
          this.error = 'Could not determine the active tab';
          this.status = 'error';
          return;
        }

        this.tabId = tab.id;
        this.origin = new URL(tab.url).origin;

        const message: GetPendingCredentialMessage = {
          type: 'GET_PENDING_CREDENTIAL',
          payload: { origin: this.origin },
        };
        const response: MessageResponse<PendingCredential | null> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.pending = response.data;
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

    async confirm(): Promise<void> {
      if (this.origin === null || this.tabId === null || this.confirming) return;

      this.confirming = true;
      this.actionError = null;

      try {
        const message: ConfirmPendingCredentialMessage = {
          type: 'CONFIRM_PENDING_CREDENTIAL',
          payload: { origin: this.origin, tabId: this.tabId },
        };
        const response: MessageResponse<CredentialRecord> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.savedCredential = response.data;
          this.pending = null;
        } else {
          this.actionError = response.error;
        }
      } catch (err) {
        this.actionError = err instanceof Error ? err.message : String(err);
      } finally {
        this.confirming = false;
      }
    },

    async discard(): Promise<void> {
      if (this.origin === null || this.tabId === null || this.discarding) return;

      this.discarding = true;
      this.actionError = null;

      try {
        const message: DiscardPendingCredentialMessage = {
          type: 'DISCARD_PENDING_CREDENTIAL',
          payload: { origin: this.origin, tabId: this.tabId },
        };
        const response: MessageResponse<undefined> = await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.pending = null;
        } else {
          this.actionError = response.error;
        }
      } catch (err) {
        this.actionError = err instanceof Error ? err.message : String(err);
      } finally {
        this.discarding = false;
      }
    },
  },
});
