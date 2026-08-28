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
  ExportVaultBackupMessage,
  ExportVaultBackupResponse,
  MessageResponse,
  RestoreVaultBackupMessage,
  RestoreVaultBackupResponse,
  UnlockInput,
  VaultBackupBundle,
  VaultLockMessage,
  VaultStatusMessage,
  VaultStatusResponse,
  VaultUnlockMessage,
} from '../shared/messages';
import { VaultBackupBundleSchema } from '../shared/messages';

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

// The passkey half of an UnlockInput, extracted from setupWithPasskey's own
// body (M7) so restoreWithPasskey can run the identical WebAuthn ceremony
// -- including its footgun-avoidance behavior above -- without duplicating
// it. Returns the full UnlockInput (not just the credential) since it
// already carries credentialId, which callers need for their own
// post-success state update.
async function createPasskeyUnlockInput(): Promise<
  Extract<UnlockInput, { unlockMethod: 'passkey' }>
> {
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
  return {
    unlockMethod: 'passkey',
    prfOutputB64: bytesToBase64(bufferSourceToBytes(prfOutput)),
    credentialId: credential.id,
    rpId: `chrome-extension://${browser.runtime.id}`,
  };
}

// A file read from disk is fundamentally different from every other
// message this store builds (a typed passphrase, a credential.id from a
// real WebAuthn ceremony) -- it's arbitrary, possibly hand-edited content.
// Validated here, BEFORE either restore action does anything else -- a
// malformed file caught only by the background's own Zod validation would
// still have already run a full WebAuthn ceremony first in
// restoreWithPasskey's case, registering a real, un-revocable resident
// credential on the user's authenticator for a restore that was always
// going to fail (a Plan agent's finding).
async function parseAndValidateBundleFile(file: File): Promise<VaultBackupBundle> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON -- is it really a backup file?');
  }
  const result = VaultBackupBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("That file doesn't look like an Identity Firewall backup.");
  }
  return result.data;
}

// Shared by restoreWithPasskey/restoreWithPassphrase -- the one part of
// those two actions that's genuinely identical (message shape and response
// type), extracted per a /code-review finding. The surrounding
// status/try-catch skeleton is deliberately NOT extracted into this helper
// -- every action in this store repeats that same skeleton inline (matching
// stores/session.store.ts's own established convention), so folding it into
// a shared wrapper here would be inconsistent with the rest of the file,
// not more consistent.
function sendRestoreVaultBackup(
  bundle: VaultBackupBundle,
  backupPassphrase: string,
  newUnlockInput: UnlockInput,
): Promise<MessageResponse<RestoreVaultBackupResponse>> {
  const message: RestoreVaultBackupMessage = {
    type: 'RESTORE_VAULT_BACKUP',
    payload: { bundle, backupPassphrase, newUnlockInput },
  };
  return browser.runtime.sendMessage(message);
}

function downloadBackupBundle(bundle: VaultBackupBundle): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `identity-firewall-backup-${Date.now()}.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
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
        const unlockInput = await createPasskeyUnlockInput();

        const message: CreateRootIdentityMessage = {
          type: 'CREATE_ROOT_IDENTITY',
          payload: unlockInput,
        };
        const response: MessageResponse<Record<string, never>> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.initialized = true;
          this.locked = false;
          this.configuredUnlockMethod = 'passkey';
          this.passkeyCredentialId = unlockInput.credentialId;
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

    async exportBackup(backupPassphrase: string): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: ExportVaultBackupMessage = {
        type: 'EXPORT_VAULT_BACKUP',
        payload: { backupPassphrase },
      };

      try {
        const response: MessageResponse<ExportVaultBackupResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          downloadBackupBundle(response.data);
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

    // KNOWN LIMITATION, deliberately deferred (a /code-review finding):
    // parseAndValidateBundleFile only checks the file's JSON SHAPE, not
    // whether backupPassphrase actually decrypts it -- that decryption only
    // happens in the background (background/vault/export.ts), since this
    // store never touches crypto.subtle (see this file's own header
    // comment). So a schema-valid file with a WRONG backupPassphrase, or one
    // whose ciphertext got corrupted while staying schema-valid, still runs
    // this full WebAuthn ceremony -- registering a real, un-revocable
    // resident credential on the user's authenticator -- before the
    // background's decryption fails and the restore is rejected. Properly
    // closing this would mean adding a "verify this bundle decrypts"
    // message the popup could check before ever touching WebAuthn, which is
    // a real message-contract change, not a same-milestone bug fix -- left
    // as a follow-up rather than done ad hoc here.
    async restoreWithPasskey(file: File, backupPassphrase: string): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const bundle = await parseAndValidateBundleFile(file);
        const unlockInput = await createPasskeyUnlockInput();

        const response: MessageResponse<RestoreVaultBackupResponse> = await sendRestoreVaultBackup(
          bundle,
          backupPassphrase,
          unlockInput,
        );
        if (response.ok) {
          this.initialized = true;
          this.locked = false;
          this.configuredUnlockMethod = 'passkey';
          this.passkeyCredentialId = unlockInput.credentialId;
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

    async restoreWithPassphrase(
      file: File,
      backupPassphrase: string,
      newPassphrase: string,
    ): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const bundle = await parseAndValidateBundleFile(file);
        const unlockInput: UnlockInput = {
          unlockMethod: 'passphrase',
          passphrase: newPassphrase,
        };
        const response: MessageResponse<RestoreVaultBackupResponse> = await sendRestoreVaultBackup(
          bundle,
          backupPassphrase,
          unlockInput,
        );
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
  },
});
