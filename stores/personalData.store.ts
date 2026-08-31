// Popup-side Pinia store for Phase 5 M1 -- the Personal Data screen.
// Unlike firewall.store.ts/privacyLedger.store.ts, this store has no
// active-tab/origin dependency at all: PersonalData is one single
// vault-wide blob (shared/vault-schema.ts), not scoped per site. Mirrors
// privacyLedger.store.ts's fetch-on-mount shape otherwise.
//
// GET_PERSONAL_DATA/SET_PERSONAL_DATA have both existed, fully working,
// since Phase 2 M6 -- this store is the first thing that ever calls them
// from the popup. Before this, "Real" had no data to ever return, since
// there was no UI to populate PersonalData at all.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  GetPersonalDataMessage,
  MessageResponse,
  SetPersonalDataMessage,
} from '../shared/messages';
import type { PersonalData } from '../shared/vault-schema';

export interface PersonalDataStoreState {
  data: PersonalData;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  saving: boolean;
  saveError: string | null;
}

export const usePersonalDataStore = defineStore('personalData', {
  state: (): PersonalDataStoreState => ({
    data: {},
    status: 'idle',
    error: null,
    saving: false,
    saveError: null,
  }),
  actions: {
    async fetchPersonalData(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const message: GetPersonalDataMessage = { type: 'GET_PERSONAL_DATA', payload: {} };
        const response: MessageResponse<PersonalData> = await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.data = response.data;
          this.status = 'loaded';
        } else {
          // Most commonly VAULT_LOCKED (readPersonalDataBlob's own guard) --
          // shown as a plain error string, same convention firewall.store.ts
          // already established for the identical underlying cause.
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },

    // patch: only the fields actually changed -- SET_PERSONAL_DATA is
    // already patch-style server-side (a key omitted here leaves the
    // stored value untouched), so the caller can pass just what changed.
    async savePersonalData(patch: PersonalData): Promise<void> {
      this.saving = true;
      this.saveError = null;

      try {
        const message: SetPersonalDataMessage = { type: 'SET_PERSONAL_DATA', payload: patch };
        const response: MessageResponse<PersonalData> = await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.data = response.data;
        } else {
          this.saveError = response.error;
        }
      } catch (err) {
        this.saveError = err instanceof Error ? err.message : String(err);
      } finally {
        this.saving = false;
      }
    },
  },
});
