// Popup-side Pinia store for the standalone "Generate password" section --
// independent of any form on the current page (unlike savedCredentials.store.ts,
// which is scoped to whatever the active tab's origin already has saved).
// generate() is a pure, local, zero-round-trip call into
// shared/passwordGenerator.ts; only save() talks to the background, reusing
// the existing SAVE_CREDENTIAL message as-is -- handleSaveCredential
// (background/vault/credentials/handler.ts) already creates the
// ServiceIdentity for a brand-new origin idempotently, so saving to a site
// with no prior form/identity needs no backend change.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  MessageResponse,
  SaveCredentialMessage,
  SaveCredentialResponse,
} from '../shared/messages';
import { normalizeOrigin } from '../shared/origin';
import { generatePassword } from '../shared/passwordGenerator';
import type { CredentialRecord } from '../shared/vault-schema';

export interface PasswordGeneratorStoreState {
  password: string;
  origin: string;
  username: string;
  saving: boolean;
  saveError: string | null;
  justSaved: boolean;
}

// Convenience-only coercion for this feature's own free-text origin input --
// deliberately NOT added to shared/origin.ts's normalizeOrigin itself, which
// stays a strict, security-critical primitive (KDF input, storage key) used
// well beyond this one text field. A bare domain (no scheme) is the most
// common way a person would type a site here.
function coerceOriginInput(input: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
}

export const usePasswordGeneratorStore = defineStore('passwordGenerator', {
  state: (): PasswordGeneratorStoreState => ({
    password: '',
    origin: '',
    username: '',
    saving: false,
    saveError: null,
    justSaved: false,
  }),
  actions: {
    generate(): void {
      this.password = generatePassword();
      this.saveError = null;
      this.justSaved = false;
    },

    async save(): Promise<void> {
      this.saving = true;
      this.saveError = null;
      this.justSaved = false;

      try {
        const normalizedOrigin = normalizeOrigin(coerceOriginInput(this.origin));
        const credential: CredentialRecord = {
          kind: 'password',
          username: this.username || null,
          password: this.password,
        };
        const message: SaveCredentialMessage = {
          type: 'SAVE_CREDENTIAL',
          payload: { origin: normalizedOrigin, credential },
        };
        const response: MessageResponse<SaveCredentialResponse> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
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
