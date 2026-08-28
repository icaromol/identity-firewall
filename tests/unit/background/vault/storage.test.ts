import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  decryptBlob,
  encryptBlob,
  generateAesGcmKeyFromBits,
  randomBytes,
} from '../../../../background/vault/crypto';
import {
  clearCachedUnlockKey,
  decryptVaultDataWithKey,
  getCachedUnlockKey,
  getPassphraseArgon2Params,
  initializeVaultData,
  PassphraseArgon2ParamsCorruptedError,
  readVaultData,
  setCachedUnlockKey,
  setPassphraseArgon2Params,
  updateVaultData,
  VaultAlreadyInitializedError,
  VaultLockedError,
  VaultNotInitializedError,
  vaultBlobExists,
} from '../../../../background/vault/storage';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { VaultData } from '../../../../shared/vault-schema';

function minimalVaultData(overrides: Partial<VaultData> = {}): VaultData {
  return {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    personalData: {},
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
    ...overrides,
  };
}

describe('vault storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  describe('vaultBlobExists', () => {
    it('is false before any vault is initialized', async () => {
      expect(await vaultBlobExists()).toBe(false);
    });

    it('is true after initializeVaultData', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeVaultData(minimalVaultData(), key);
      expect(await vaultBlobExists()).toBe(true);
    });
  });

  describe('getCachedUnlockKey / setCachedUnlockKey / clearCachedUnlockKey', () => {
    it('returns null when nothing is cached', async () => {
      expect(await getCachedUnlockKey()).toBeNull();
    });

    it('caches raw bits and reconstructs a working key on read', async () => {
      const bits = randomBytes(32);
      await setCachedUnlockKey(bits);

      const cachedKey = await getCachedUnlockKey();
      expect(cachedKey).not.toBeNull();

      // Functional check: a key derived independently from the SAME bits
      // must be able to decrypt what the cached key encrypted -- proving
      // getCachedUnlockKey() reconstructed the right key, not just *a* key.
      const independentKey = await generateAesGcmKeyFromBits(bits);
      const plaintext = new TextEncoder().encode('hello vault');
      const { iv, ciphertext } = await encryptBlob(cachedKey as CryptoKey, plaintext);
      const decrypted = await decryptBlob(independentKey, iv, ciphertext);
      expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
    });

    it('clears the cached key', async () => {
      await setCachedUnlockKey(randomBytes(32));
      await clearCachedUnlockKey();
      expect(await getCachedUnlockKey()).toBeNull();
    });

    it('treats malformed cached bits (wrong length) as no key cached, not a thrown error', async () => {
      const wrongLengthBits = bytesToBase64(randomBytes(5)); // valid base64, invalid AES-GCM key length
      await fakeBrowser.storage.session.set({ if_vault_unlock_key_v1: wrongLengthBits });
      expect(await getCachedUnlockKey()).toBeNull();
    });
  });

  describe('initializeVaultData / readVaultData / updateVaultData', () => {
    it('throws VaultLockedError from readVaultData when no key is cached', async () => {
      await expect(readVaultData()).rejects.toThrow(VaultLockedError);
    });

    it('throws VaultNotInitializedError when a key is cached but no blob exists', async () => {
      const bits = randomBytes(32);
      await setCachedUnlockKey(bits);
      await expect(readVaultData()).rejects.toThrow(VaultNotInitializedError);
    });

    it('round-trips an initial vault through initializeVaultData and readVaultData', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      const initial = minimalVaultData();

      await initializeVaultData(initial, key);
      await setCachedUnlockKey(bits);

      expect(await readVaultData()).toEqual(initial);
    });

    it('throws VaultAlreadyInitializedError on a second initializeVaultData call', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeVaultData(minimalVaultData(), key);
      await expect(initializeVaultData(minimalVaultData(), key)).rejects.toThrow(
        VaultAlreadyInitializedError,
      );
    });

    it('persists a mutation made through updateVaultData', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultData(minimalVaultData(), key);
      await setCachedUnlockKey(bits);

      await updateVaultData((draft) => ({
        ...draft,
        personalData: { ...draft.personalData, email: 'alice@example.com' },
      }));

      const data = await readVaultData();
      expect(data.personalData.email).toBe('alice@example.com');
    });

    it('rejects a mutator that returns schema-invalid data', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultData(minimalVaultData(), key);
      await setCachedUnlockKey(bits);

      await expect(
        updateVaultData(
          () =>
            ({
              schemaVersion: 2, // invalid: must be literal 1
            }) as unknown as VaultData,
        ),
      ).rejects.toThrow();
    });

    it('survives two concurrent updateVaultData calls mutating different sub-trees', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultData(minimalVaultData(), key);
      await setCachedUnlockKey(bits);

      await Promise.all([
        updateVaultData((draft) => ({
          ...draft,
          personalData: { ...draft.personalData, email: 'alice@example.com' },
        })),
        updateVaultData((draft) => ({
          ...draft,
          privacyLedger: [
            ...draft.privacyLedger,
            {
              origin: 'https://example.com',
              at: 1,
              requestedFields: [],
              disclosedFields: [],
              deniedFields: [],
            },
          ],
        })),
      ]);

      const data = await readVaultData();
      expect(data.personalData.email).toBe('alice@example.com');
      expect(data.privacyLedger).toHaveLength(1);
    });
  });

  describe('getPassphraseArgon2Params / setPassphraseArgon2Params', () => {
    it('returns undefined when never configured', async () => {
      expect(await getPassphraseArgon2Params()).toBeUndefined();
    });

    it('round-trips configured params', async () => {
      await setPassphraseArgon2Params({ t: 3, m: 65536, p: 2 });
      expect(await getPassphraseArgon2Params()).toEqual({ t: 3, m: 65536, p: 2 });
    });

    it('throws PassphraseArgon2ParamsCorruptedError when the stored value fails schema validation', async () => {
      await fakeBrowser.storage.local.set({ if_vault_passphrase_kdf_v1: { t: -1 } });
      await expect(getPassphraseArgon2Params()).rejects.toThrow(
        PassphraseArgon2ParamsCorruptedError,
      );
    });
  });

  describe('decryptVaultDataWithKey', () => {
    it('rejects when decrypting with the wrong key', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      const wrongKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeVaultData(minimalVaultData(), key);

      await expect(decryptVaultDataWithKey(wrongKey)).rejects.toThrow();
    });
  });
});
