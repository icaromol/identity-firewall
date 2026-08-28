// @vitest-environment jsdom
//
// The one file in this repo using jsdom -- vault.store.ts is the one file
// that calls navigator.credentials, which needs a document context to even
// exist as a global. jsdom provides no navigator.credentials by default
// (confirmed empirically), so it's defined manually below. Never calls real
// crypto.subtle here -- all crypto happens in background/vault/*, already
// covered under the default `node` environment elsewhere.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { base64UrlToBytes, bytesToBase64 } from '../../../shared/bytes';
import { useVaultStore } from '../../../stores/vault.store';

const mockCreate = vi.fn();
const mockGet = vi.fn();

Object.defineProperty(globalThis.navigator, 'credentials', {
  value: { create: mockCreate, get: mockGet },
  configurable: true,
});

// Uint8Array<ArrayBuffer>, not bare Uint8Array: .buffer needs to type-check
// as ArrayBuffer (not the wider ArrayBufferLike) when handed to
// fixtureCredential -- see background/vault/crypto.ts's header comment for
// the full explanation of this TS 5.7+ BufferSource strictness.
function fixturePrfOutput(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

interface FixtureWebAuthnCallArgs {
  publicKey: {
    allowCredentials?: Array<{ id: Uint8Array }>;
    extensions?: { prf?: { eval?: { first?: Uint8Array } } };
  };
}

function firstCallArgs(mockFn: typeof mockCreate | typeof mockGet): FixtureWebAuthnCallArgs {
  const [args] = (mockFn.mock.calls[0] ?? []) as [FixtureWebAuthnCallArgs];
  return args;
}

function fixtureCredential(options: { id?: string; prfResultsFirst?: ArrayBuffer }) {
  return {
    id: options.id ?? 'fixture-credential-id',
    rawId: new ArrayBuffer(16),
    getClientExtensionResults: () => ({
      prf:
        options.prfResultsFirst !== undefined
          ? { enabled: true, results: { first: options.prfResultsFirst } }
          : { enabled: true },
    }),
  };
}

describe('useVaultStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
    mockCreate.mockReset();
    mockGet.mockReset();
  });

  describe('fetchStatus', () => {
    it('populates state on a successful response', async () => {
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
        ok: true,
        data: {
          initialized: true,
          locked: false,
          configuredUnlockMethod: 'passphrase',
          passkeyCredentialId: undefined,
        },
      } as never);

      const store = useVaultStore();
      await store.fetchStatus();

      expect(store.status).toBe('loaded');
      expect(store.initialized).toBe(true);
      expect(store.locked).toBe(false);
      expect(store.configuredUnlockMethod).toBe('passphrase');
    });

    it('sets error state on a handler-level failure', async () => {
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
        ok: false,
        error: 'boom',
      } as never);

      const store = useVaultStore();
      await store.fetchStatus();

      expect(store.status).toBe('error');
      expect(store.error).toBe('boom');
    });

    it('sets error state when the transport itself rejects', async () => {
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValueOnce(
        new Error('Extension context invalidated.'),
      );

      const store = useVaultStore();
      await store.fetchStatus();

      expect(store.status).toBe('error');
      expect(store.error).toBe('Extension context invalidated.');
    });
  });

  describe('setupWithPasskey', () => {
    it('uses the PRF output from create() directly when available', async () => {
      const prfOutput = fixturePrfOutput();
      mockCreate.mockResolvedValueOnce(fixtureCredential({ prfResultsFirst: prfOutput.buffer }));
      const sendMessage = vi
        .spyOn(fakeBrowser.runtime, 'sendMessage')
        .mockResolvedValueOnce({ ok: true, data: {} } as never);

      const store = useVaultStore();
      await store.setupWithPasskey();

      expect(mockGet).not.toHaveBeenCalled();
      expect(store.status).toBe('loaded');
      expect(store.initialized).toBe(true);
      expect(store.locked).toBe(false);
      expect(store.configuredUnlockMethod).toBe('passkey');
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'CREATE_ROOT_IDENTITY',
        payload: {
          unlockMethod: 'passkey',
          prfOutputB64: bytesToBase64(prfOutput),
          credentialId: 'fixture-credential-id',
          rpId: 'chrome-extension://test-extension-id',
        },
      });
    });

    it('falls back to an immediate get() when create() reports enabled but no output (the Attestto footgun)', async () => {
      const prfOutput = fixturePrfOutput();
      mockCreate.mockResolvedValueOnce(fixtureCredential({}));
      mockGet.mockResolvedValueOnce(fixtureCredential({ prfResultsFirst: prfOutput.buffer }));
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
        ok: true,
        data: {},
      } as never);

      const store = useVaultStore();
      await store.setupWithPasskey();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(store.status).toBe('loaded');
    });

    it('sets error state when the user cancels the create() ceremony', async () => {
      mockCreate.mockResolvedValueOnce(null);

      const store = useVaultStore();
      await store.setupWithPasskey();

      expect(store.status).toBe('error');
    });

    it('sets error state when neither create() nor the fallback get() yields a PRF output', async () => {
      mockCreate.mockResolvedValueOnce(fixtureCredential({}));
      mockGet.mockResolvedValueOnce(fixtureCredential({}));

      const store = useVaultStore();
      await store.setupWithPasskey();

      expect(store.status).toBe('error');
    });
  });

  describe('setupWithPassphrase', () => {
    it('sends CREATE_ROOT_IDENTITY with the passphrase and makes no WebAuthn call', async () => {
      const sendMessage = vi
        .spyOn(fakeBrowser.runtime, 'sendMessage')
        .mockResolvedValueOnce({ ok: true, data: {} } as never);

      const store = useVaultStore();
      await store.setupWithPassphrase('correct horse battery staple');

      expect(mockCreate).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'CREATE_ROOT_IDENTITY',
        payload: { unlockMethod: 'passphrase', passphrase: 'correct horse battery staple' },
      });
      expect(store.configuredUnlockMethod).toBe('passphrase');
      expect(store.locked).toBe(false);
    });
  });

  describe('unlockWithPasskey', () => {
    it('builds allowCredentials from the persisted credentialId', async () => {
      const prfOutput = fixturePrfOutput();
      const credentialId = 'CQkJCQ'; // base64url of [9, 9, 9, 9]
      mockGet.mockResolvedValueOnce(fixtureCredential({ prfResultsFirst: prfOutput.buffer }));
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
        ok: true,
        data: {},
      } as never);

      const store = useVaultStore();
      store.passkeyCredentialId = credentialId;
      await store.unlockWithPasskey();

      expect(store.status).toBe('loaded');
      expect(store.locked).toBe(false);
      const getCallArgs = firstCallArgs(mockGet);
      expect(getCallArgs.publicKey.allowCredentials?.[0]?.id).toEqual(
        base64UrlToBytes(credentialId),
      );
    });

    it('sets error state and makes no WebAuthn call if no passkeyCredentialId is known', async () => {
      const store = useVaultStore();
      store.passkeyCredentialId = undefined;
      await store.unlockWithPasskey();

      expect(store.status).toBe('error');
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('uses the exact same PRF eval input at setup and at every unlock (regression guard)', async () => {
      const prfOutput = fixturePrfOutput();
      mockCreate.mockResolvedValueOnce(fixtureCredential({ prfResultsFirst: prfOutput.buffer }));
      vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({
        ok: true,
        data: {},
      } as never);

      const store = useVaultStore();
      await store.setupWithPasskey();
      const evalFirstAtSetup = firstCallArgs(mockCreate).publicKey.extensions?.prf?.eval?.first;

      mockGet.mockResolvedValueOnce(fixtureCredential({ prfResultsFirst: prfOutput.buffer }));
      store.passkeyCredentialId = 'AQID'; // base64url of [1, 2, 3]
      await store.unlockWithPasskey();
      const evalFirstAtUnlock = firstCallArgs(mockGet).publicKey.extensions?.prf?.eval?.first;

      expect(evalFirstAtUnlock).toEqual(evalFirstAtSetup);
    });
  });

  describe('unlockWithPassphrase', () => {
    it('sends VAULT_UNLOCK with the passphrase', async () => {
      const sendMessage = vi
        .spyOn(fakeBrowser.runtime, 'sendMessage')
        .mockResolvedValueOnce({ ok: true, data: {} } as never);

      const store = useVaultStore();
      await store.unlockWithPassphrase('correct horse battery staple');

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'VAULT_UNLOCK',
        payload: { unlockMethod: 'passphrase', passphrase: 'correct horse battery staple' },
      });
      expect(store.locked).toBe(false);
    });
  });

  describe('lock', () => {
    it('sends a bare VAULT_LOCK message and sets locked to true', async () => {
      const sendMessage = vi
        .spyOn(fakeBrowser.runtime, 'sendMessage')
        .mockResolvedValueOnce({ ok: true, data: {} } as never);

      const store = useVaultStore();
      await store.lock();

      expect(sendMessage).toHaveBeenCalledWith({ type: 'VAULT_LOCK' });
      expect(store.locked).toBe(true);
    });
  });
});
