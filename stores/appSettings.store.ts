// Options-page-side Pinia store for Phase 7 Part A -- the Configuration
// tab's auto-lock/credential-mode settings. Same fetch-on-mount,
// patch-style-save shape as stores/personalData.store.ts: no active-tab
// dependency at all, since app settings are one vault-wide (really,
// browser-profile-wide) blob, not scoped per site.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  GetAppSettingsMessage,
  GetAppSettingsResponse,
  MessageResponse,
  SetAppSettingsMessage,
  SetAppSettingsResponse,
} from '../shared/messages';
import type { AppSettings } from '../shared/settings';
import { DEFAULT_APP_SETTINGS } from '../shared/settings';

export interface AppSettingsStoreState {
  data: AppSettings;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  saving: boolean;
  saveError: string | null;
  justSaved: boolean;
}

export const useAppSettingsStore = defineStore('appSettings', {
  state: (): AppSettingsStoreState => ({
    data: DEFAULT_APP_SETTINGS,
    status: 'idle',
    error: null,
    saving: false,
    saveError: null,
    justSaved: false,
  }),
  actions: {
    async fetchAppSettings(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetAppSettingsMessage = { type: 'GET_APP_SETTINGS', payload: {} };

      try {
        const response: MessageResponse<GetAppSettingsResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.data = response.data;
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

    async saveAppSettings(patch: Partial<AppSettings>): Promise<void> {
      this.saving = true;
      this.saveError = null;
      this.justSaved = false;

      const message: SetAppSettingsMessage = { type: 'SET_APP_SETTINGS', payload: patch };

      try {
        const response: MessageResponse<SetAppSettingsResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.data = response.data;
          this.justSaved = true;
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
