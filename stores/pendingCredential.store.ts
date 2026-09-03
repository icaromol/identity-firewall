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
  TakeAutoSaveNoticeMessage,
} from '../shared/messages';
import type { CredentialRecord } from '../shared/vault-schema';
import { resolveActiveTab } from './shared/activeTab';

export interface PendingCredentialStoreState {
  origin: string | null;
  tabId: number | null;
  pending: PendingCredential | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  confirming: boolean;
  discarding: boolean;
  actionError: string | null;
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
  }),
  actions: {
    async fetchPendingCredential(): Promise<void> {
      this.status = 'loading';
      this.error = null;
      this.actionError = null;

      try {
        const { tabId, origin } = await resolveActiveTab();
        this.tabId = tabId;
        this.origin = origin;

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

    // Phase 7 Part A M4 -- best-effort only: whether a credential was just
    // auto-saved for the active tab's origin, get-and-clear so it's never
    // shown twice. Returns false (never throws) on any failure -- this is
    // a one-time confirmation, not something anything else depends on, so
    // a failed tab-resolution or message round trip should just mean no
    // toast, not a reported error.
    async checkAutoSaveNotice(): Promise<boolean> {
      try {
        const { origin } = await resolveActiveTab();
        const message: TakeAutoSaveNoticeMessage = {
          type: 'TAKE_AUTO_SAVE_NOTICE',
          payload: { origin },
        };
        const response: MessageResponse<boolean> = await browser.runtime.sendMessage(message);
        return response.ok && response.data;
      } catch {
        return false;
      }
    },
  },
});
