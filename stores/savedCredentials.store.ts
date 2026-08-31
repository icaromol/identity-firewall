// Popup-side Pinia store for Phase 5 M5 -- the saved-credential list and
// fill action. Mirrors firewall.store.ts's active-tab-origin resolution
// (credentials are per-site, like the pending firewall request, not a
// single vault-wide blob the way personalData.store.ts is).

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  FillCredentialMessage,
  GetCredentialMessage,
  MessageResponse,
} from '../shared/messages';
import type { CredentialRecord } from '../shared/vault-schema';
import { resolveActiveTab } from './shared/activeTab';

export interface SavedCredentialsStoreState {
  origin: string | null;
  tabId: number | null;
  credentials: CredentialRecord[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  filling: CredentialRecord | null;
  fillError: string | null;
}

export const useSavedCredentialsStore = defineStore('savedCredentials', {
  state: (): SavedCredentialsStoreState => ({
    origin: null,
    tabId: null,
    credentials: [],
    status: 'idle',
    error: null,
    filling: null,
    fillError: null,
  }),
  actions: {
    async fetchCredentials(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const { tabId, origin } = await resolveActiveTab();
        this.tabId = tabId;
        this.origin = origin;

        const message: GetCredentialMessage = {
          type: 'GET_CREDENTIAL',
          payload: { origin: this.origin },
        };
        const response: MessageResponse<CredentialRecord[]> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.credentials = response.data;
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

    async fill(credential: CredentialRecord): Promise<void> {
      // Guards against an overlapping call the same way confirm()/discard()
      // do (stores/pendingCredential.store.ts) -- without it, a double-click
      // before Vue's next render disables the button could fire two
      // concurrent FILL_CREDENTIAL calls, whose `finally` blocks would then
      // race to clear `filling`/`fillError` (/code-review finding).
      if (this.origin === null || this.tabId === null || this.filling !== null) return;

      this.filling = credential;
      this.fillError = null;

      try {
        const message: FillCredentialMessage = {
          type: 'FILL_CREDENTIAL',
          payload: { origin: this.origin, tabId: this.tabId, credential },
        };
        const response: MessageResponse<{ filled: boolean }> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          if (!response.data.filled) {
            this.fillError = 'No login form found on this page to fill.';
          }
        } else {
          this.fillError = response.error;
        }
      } catch (err) {
        this.fillError = err instanceof Error ? err.message : String(err);
      } finally {
        this.filling = null;
      }
    },
  },
});
