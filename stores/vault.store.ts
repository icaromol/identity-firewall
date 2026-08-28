// Popup-side Pinia store for M4. The ONLY place navigator.credentials.
// create()/get() with the `prf` extension is called -- background service
// workers cannot call WebAuthn at all (it requires a document context), a
// real, previously-shipped Attestto constraint (research/attestto-teardown.md
// §8.7). Only the resulting PRF bytes (or, for the passphrase fallback, the
// raw passphrase) cross the message boundary to background -- this store
// itself never touches crypto.subtle.
//
// Mirrors session.store.ts's conventions: Options-API defineStore, explicit
// message construction, MessageResponse<T> handling, the same
// status/error-handling shape (a { ok: false } handler failure and a
// rejected sendMessage transport failure both land in the same error state).
//
// PRF_EVAL_INPUT is a FIXED constant, reused identically at setup and every
// unlock -- the WebAuthn PRF extension is spec'd to be a deterministic
// function of (credential, eval input), the same property Attestto's own
// shipped code relies on (research/attestto-teardown.md). It is NOT the same
// thing as background/vault/keys.ts's PASSKEY_UNLOCK_INFO -- that's the
// server-side HKDF `info` applied AFTER this PRF output already exists; this
// is the client-side input to the PRF extension itself.
//
// The extension's own rp.id/rpId is deliberately left OUT of every WebAuthn
// call below, not manually constructed as `chrome-extension://${id}` --
// confirmed (Chrome team W3C mailing list; MDN's WebExtensions-WebAuthn page)
// that omitting rp.id/rpId lets the browser default to exactly that value
// automatically, avoiding any risk of a subtly-wrong manual format. The
// `rpId` field still sent in UnlockInput messages (required by the existing
// schema, unused by any handler logic today) is populated with the
// constructed string purely for informational/future-debugging value.
//
// Passkey unlock uses a PERSISTED credentialId + explicit allowCredentials,
// not discoverable-credential resolution with an empty allowCredentials --
// the latter is a real, standard WebAuthn pattern in general but unverified
// for extension-scoped rp.id values specifically, and Attestto's own shipped
// code (the one piece of real production evidence available) went the
// persisted-credentialId route for its own vault-unlock ceremony too.
//
// Chrome/Chromium only for the passkey path (see docs/plans/
// phase-2-local-identity-vault.md's M4 section) -- Firefox extensions have
// no equivalent of Chrome's zero-permission own-origin rp.id claim, and a
// live Firefox bug closes the WebExtension popup the instant a WebAuthn
// prompt appears. Firefox users use the passphrase fallback until revisited.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import { base64UrlToBytes, bytesToBase64 } from '../shared/bytes';
import type {
  CreateRootIdentityMessage,
  MessageResponse,
  VaultLockMessage,
  VaultStatusMessage,
  VaultStatusResponse,
  VaultUnlockMessage,
} from '../shared/messages';

// Uint8Array<ArrayBuffer> annotations below (not bare Uint8Array) are a
// TS-only concession, not a runtime one -- see background/vault/crypto.ts's
// header comment for the full explanation of this TS 5.7+ BufferSource
// strictness. Both values here are genuinely ArrayBuffer-backed.
const PRF_EVAL_INPUT: Uint8Array<ArrayBuffer> = new TextEncoder().encode(
  'identity-firewall:vault-unlock:prf-eval:v1',
);

function randomChallenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

function bufferSourceToBytes(source: BufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

// create()/registration commonly reports prf.enabled: true without ever
// returning results.first -- only a subsequent get()/assertion reliably
// returns it (the documented Attestto footgun). This must always be tried
// immediately after registration, never treated as "unsupported" from the
// create() response alone.
async function obtainPrfOutputAfterCreate(credential: PublicKeyCredential): Promise<BufferSource> {
  const fromCreate = credential.getClientExtensionResults().prf?.results?.first;
  if (fromCreate) return fromCreate;

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
    },
  })) as PublicKeyCredential | null;
  if (!assertion) {
    throw new Error('WebAuthn assertion was cancelled or failed');
  }
  const output = assertion.getClientExtensionResults().prf?.results?.first;
  if (!output) {
    throw new Error('PRF extension output unavailable');
  }
  return output;
}

export interface VaultStoreState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  initialized: boolean;
  locked: boolean;
  configuredUnlockMethod: 'passkey' | 'passphrase' | undefined;
  passkeyCredentialId: string | undefined;
}

export const useVaultStore = defineStore('vault', {
  state: (): VaultStoreState => ({
    status: 'idle',
    error: null,
    initialized: false,
    locked: true,
    configuredUnlockMethod: undefined,
    passkeyCredentialId: undefined,
  }),
  actions: {
    async fetchStatus(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: VaultStatusMessage = { type: 'VAULT_STATUS' };

      try {
        const response: MessageResponse<VaultStatusResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.initialized = response.data?.initialized === true;
          this.locked = response.data?.locked !== false;
          this.configuredUnlockMethod = response.data?.configuredUnlockMethod;
          this.passkeyCredentialId = response.data?.passkeyCredentialId;
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

    async setupWithPasskey(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const credential = (await navigator.credentials.create({
          publicKey: {
            challenge: randomChallenge(),
            rp: { name: 'Identity Firewall' },
            user: { id: randomChallenge(), name: 'vault-unlock', displayName: 'Vault Unlock' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
          },
        })) as PublicKeyCredential | null;
        if (!credential) {
          throw new Error('WebAuthn credential creation was cancelled or failed');
        }

        const prfOutput = await obtainPrfOutputAfterCreate(credential);
        const prfOutputB64 = bytesToBase64(bufferSourceToBytes(prfOutput));

        const message: CreateRootIdentityMessage = {
          type: 'CREATE_ROOT_IDENTITY',
          payload: {
            unlockMethod: 'passkey',
            prfOutputB64,
            credentialId: credential.id,
            rpId: `chrome-extension://${browser.runtime.id}`,
          },
        };
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.initialized = true;
          this.locked = false;
          this.configuredUnlockMethod = 'passkey';
          this.passkeyCredentialId = credential.id;
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

    async setupWithPassphrase(passphrase: string): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: CreateRootIdentityMessage = {
        type: 'CREATE_ROOT_IDENTITY',
        payload: { unlockMethod: 'passphrase', passphrase },
      };

      try {
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.initialized = true;
          this.locked = false;
          this.configuredUnlockMethod = 'passphrase';
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

    async unlockWithPasskey(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        if (!this.passkeyCredentialId) {
          throw new Error('No passkey credential is configured for this vault');
        }
        const assertion = (await navigator.credentials.get({
          publicKey: {
            challenge: randomChallenge(),
            // `as BufferSource`: base64UrlToBytes stays bare Uint8Array since
            // it's a general-purpose codec, not WebAuthn-specific -- see
            // background/vault/crypto.ts's header comment for the full
            // explanation of this TS-only BufferSource strictness.
            allowCredentials: [
              {
                id: base64UrlToBytes(this.passkeyCredentialId) as BufferSource,
                type: 'public-key',
              },
            ],
            userVerification: 'required',
            extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
          },
        })) as PublicKeyCredential | null;
        if (!assertion) {
          throw new Error('WebAuthn assertion was cancelled or failed');
        }
        const output = assertion.getClientExtensionResults().prf?.results?.first;
        if (!output) {
          throw new Error('PRF extension output unavailable');
        }
        const prfOutputB64 = bytesToBase64(bufferSourceToBytes(output));

        const message: VaultUnlockMessage = {
          type: 'VAULT_UNLOCK',
          payload: {
            unlockMethod: 'passkey',
            prfOutputB64,
            credentialId: this.passkeyCredentialId,
            rpId: `chrome-extension://${browser.runtime.id}`,
          },
        };
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.locked = false;
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

    async unlockWithPassphrase(passphrase: string): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: VaultUnlockMessage = {
        type: 'VAULT_UNLOCK',
        payload: { unlockMethod: 'passphrase', passphrase },
      };

      try {
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.locked = false;
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

    async lock(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: VaultLockMessage = { type: 'VAULT_LOCK' };

      try {
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.locked = true;
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
