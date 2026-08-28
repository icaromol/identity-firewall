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
  getConfiguredUnlockMethod,
  getPasskeyCredentialId,
  getPassphraseArgon2Params,
  initializePersonalDataBlob,
  initializeSitePayload,
  initializeVaultData,
  initializeVaultIndex,
  PassphraseArgon2ParamsCorruptedError,
  readPersonalDataBlob,
  readSitePayload,
  readVaultData,
  readVaultIndex,
  setCachedUnlockKey,
  setPassphraseArgon2Params,
  setUnlockMethodMetadata,
  updatePersonalDataBlob,
  updatePersonalDataBlobWithResult,
  updateSitePayload,
  updateSitePayloadWithResult,
  updateVaultData,
  updateVaultIndex,
  updateVaultIndexWithResult,
  VaultAlreadyInitializedError,
  VaultLockedError,
  VaultNotInitializedError,
  vaultBlobExists,
  vaultIndexExists,
} from '../../../../background/vault/storage';
import { bytesToBase64 } from '../../../../shared/bytes';
import type {
  PersonalData,
  SitePayload,
  VaultData,
  VaultIndex,
} from '../../../../shared/vault-schema';

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

function minimalVaultIndex(overrides: Partial<VaultIndex> = {}): VaultIndex {
  return {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
    ...overrides,
  };
}

function minimalSitePayload(overrides: Partial<SitePayload> = {}): SitePayload {
  return {
    origin: 'https://example.com',
    credentials: [],
    aliases: [],
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

  describe('getConfiguredUnlockMethod / getPasskeyCredentialId', () => {
    it('both return undefined when never configured', async () => {
      expect(await getConfiguredUnlockMethod()).toBeUndefined();
      expect(await getPasskeyCredentialId()).toBeUndefined();
    });
  });

  describe('setUnlockMethodMetadata', () => {
    it('writes "passphrase" and its Argon2 params together', async () => {
      await setUnlockMethodMetadata({
        method: 'passphrase',
        argon2Params: { t: 2, m: 19456, p: 1 },
      });

      expect(await getConfiguredUnlockMethod()).toBe('passphrase');
      expect(await getPassphraseArgon2Params()).toEqual({ t: 2, m: 19456, p: 1 });
      expect(await getPasskeyCredentialId()).toBeUndefined();
    });

    it('writes "passkey" and its credential id together', async () => {
      await setUnlockMethodMetadata({ method: 'passkey', credentialId: 'fixture-credential-id' });

      expect(await getConfiguredUnlockMethod()).toBe('passkey');
      expect(await getPasskeyCredentialId()).toBe('fixture-credential-id');
      expect(await getPassphraseArgon2Params()).toBeUndefined();
    });

    it('a later call overwrites both fields of an earlier one', async () => {
      await setUnlockMethodMetadata({ method: 'passkey', credentialId: 'first-credential-id' });
      await setUnlockMethodMetadata({ method: 'passkey', credentialId: 'second-credential-id' });

      expect(await getPasskeyCredentialId()).toBe('second-credential-id');
    });
  });

  // --- Three-tier vault storage (ADR-015, vault tiering refactor Step 3) ---

  describe('vaultIndexExists / initializeVaultIndex / readVaultIndex / updateVaultIndex', () => {
    it('vaultIndexExists is false before any index is initialized', async () => {
      expect(await vaultIndexExists()).toBe(false);
    });

    it('vaultIndexExists is true after initializeVaultIndex', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeVaultIndex(minimalVaultIndex(), key);
      expect(await vaultIndexExists()).toBe(true);
    });

    it('throws VaultLockedError from readVaultIndex when no key is cached', async () => {
      await expect(readVaultIndex()).rejects.toThrow(VaultLockedError);
    });

    it('throws VaultNotInitializedError when a key is cached but no index exists', async () => {
      await setCachedUnlockKey(randomBytes(32));
      await expect(readVaultIndex()).rejects.toThrow(VaultNotInitializedError);
    });

    it('round-trips an initial index through initializeVaultIndex and readVaultIndex', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      const initial = minimalVaultIndex();

      await initializeVaultIndex(initial, key);
      await setCachedUnlockKey(bits);

      expect(await readVaultIndex()).toEqual(initial);
    });

    it('throws VaultAlreadyInitializedError on a second initializeVaultIndex call', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeVaultIndex(minimalVaultIndex(), key);
      await expect(initializeVaultIndex(minimalVaultIndex(), key)).rejects.toThrow(
        VaultAlreadyInitializedError,
      );
    });

    it('persists a mutation made through updateVaultIndex', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultIndex(minimalVaultIndex(), key);
      await setCachedUnlockKey(bits);

      await updateVaultIndex((draft) => ({
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
      }));

      expect((await readVaultIndex()).privacyLedger).toHaveLength(1);
    });

    it('updateVaultIndexWithResult returns the mutator-captured result', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultIndex(minimalVaultIndex(), key);
      await setCachedUnlockKey(bits);

      const result = await updateVaultIndexWithResult((draft) => ({
        next: draft,
        result: 'captured-value',
      }));
      expect(result).toBe('captured-value');
    });

    it('survives two concurrent updateVaultIndex calls mutating different sub-trees', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializeVaultIndex(minimalVaultIndex(), key);
      await setCachedUnlockKey(bits);

      await Promise.all([
        updateVaultIndex((draft) => ({
          ...draft,
          policies: [...draft.policies, { fieldSensitivity: 'public', defaultResponse: 'real' }],
        })),
        updateVaultIndex((draft) => ({
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

      const index = await readVaultIndex();
      expect(index.policies).toHaveLength(1);
      expect(index.privacyLedger).toHaveLength(1);
    });
  });

  describe('initializePersonalDataBlob / readPersonalDataBlob / updatePersonalDataBlob', () => {
    it('throws VaultLockedError from readPersonalDataBlob when no key is cached', async () => {
      await expect(readPersonalDataBlob()).rejects.toThrow(VaultLockedError);
    });

    it('round-trips through initializePersonalDataBlob and readPersonalDataBlob', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      const initial: PersonalData = { name: 'Alice' };

      await initializePersonalDataBlob(initial, key);
      await setCachedUnlockKey(bits);

      expect(await readPersonalDataBlob()).toEqual(initial);
    });

    it('throws VaultAlreadyInitializedError on a second initializePersonalDataBlob call', async () => {
      const key = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializePersonalDataBlob({}, key);
      await expect(initializePersonalDataBlob({}, key)).rejects.toThrow(
        VaultAlreadyInitializedError,
      );
    });

    it('persists a mutation made through updatePersonalDataBlob', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializePersonalDataBlob({}, key);
      await setCachedUnlockKey(bits);

      await updatePersonalDataBlob((draft) => ({ ...draft, email: 'alice@example.com' }));

      expect((await readPersonalDataBlob()).email).toBe('alice@example.com');
    });

    it('updatePersonalDataBlobWithResult returns the mutator-captured result', async () => {
      const bits = randomBytes(32);
      const key = await generateAesGcmKeyFromBits(bits);
      await initializePersonalDataBlob({}, key);
      await setCachedUnlockKey(bits);

      const result = await updatePersonalDataBlobWithResult((draft) => ({
        next: { ...draft, name: 'Bob' },
        result: 'captured-value',
      }));
      expect(result).toBe('captured-value');
      expect((await readPersonalDataBlob()).name).toBe('Bob');
    });
  });

  describe('initializeSitePayload / readSitePayload / updateSitePayload', () => {
    it('throws VaultLockedError from readSitePayload when no VaultUnlockKey is cached, even with a valid siteKey', async () => {
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await expect(readSitePayload('payload-key-a', siteKey)).rejects.toThrow(VaultLockedError);
    });

    it('throws VaultLockedError from initializeSitePayload when no VaultUnlockKey is cached', async () => {
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await expect(
        initializeSitePayload('payload-key-a', minimalSitePayload(), siteKey),
      ).rejects.toThrow(VaultLockedError);
    });

    it('round-trips through initializeSitePayload and readSitePayload', async () => {
      await setCachedUnlockKey(randomBytes(32)); // vault "unlocked" for the defense-in-depth guard
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      const initial = minimalSitePayload({ origin: 'https://a.example' });

      await initializeSitePayload('payload-key-a', initial, siteKey);

      expect(await readSitePayload('payload-key-a', siteKey)).toEqual(initial);
    });

    it('throws VaultAlreadyInitializedError on a second initializeSitePayload call for the same payloadStorageKey', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeSitePayload('payload-key-a', minimalSitePayload(), siteKey);

      await expect(
        initializeSitePayload('payload-key-a', minimalSitePayload(), siteKey),
      ).rejects.toThrow(VaultAlreadyInitializedError);
    });

    it('two different payloadStorageKeys do not collide', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const keyA = await generateAesGcmKeyFromBits(randomBytes(32));
      const keyB = await generateAesGcmKeyFromBits(randomBytes(32));

      await initializeSitePayload(
        'payload-key-a',
        minimalSitePayload({ origin: 'https://a.example' }),
        keyA,
      );
      await initializeSitePayload(
        'payload-key-b',
        minimalSitePayload({ origin: 'https://b.example' }),
        keyB,
      );

      expect((await readSitePayload('payload-key-a', keyA)).origin).toBe('https://a.example');
      expect((await readSitePayload('payload-key-b', keyB)).origin).toBe('https://b.example');
    });

    it('rejects reading a site payload with the wrong key', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const rightKey = await generateAesGcmKeyFromBits(randomBytes(32));
      const wrongKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeSitePayload('payload-key-a', minimalSitePayload(), rightKey);

      await expect(readSitePayload('payload-key-a', wrongKey)).rejects.toThrow();
    });

    it('persists a mutation made through updateSitePayload', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeSitePayload('payload-key-a', minimalSitePayload(), siteKey);

      await updateSitePayload('payload-key-a', siteKey, (draft) => ({
        ...draft,
        credentials: [{ kind: 'password', username: 'alice', password: 'hunter2' }],
      }));

      expect((await readSitePayload('payload-key-a', siteKey)).credentials).toHaveLength(1);
    });

    it('updateSitePayloadWithResult returns the mutator-captured result', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const siteKey = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeSitePayload('payload-key-a', minimalSitePayload(), siteKey);

      const result = await updateSitePayloadWithResult('payload-key-a', siteKey, (draft) => ({
        next: draft,
        result: 'captured-value',
      }));
      expect(result).toBe('captured-value');
    });

    it('survives two concurrent updates to two different site payloads', async () => {
      await setCachedUnlockKey(randomBytes(32));
      const keyA = await generateAesGcmKeyFromBits(randomBytes(32));
      const keyB = await generateAesGcmKeyFromBits(randomBytes(32));
      await initializeSitePayload(
        'payload-key-a',
        minimalSitePayload({ origin: 'https://a.example' }),
        keyA,
      );
      await initializeSitePayload(
        'payload-key-b',
        minimalSitePayload({ origin: 'https://b.example' }),
        keyB,
      );

      await Promise.all([
        updateSitePayload('payload-key-a', keyA, (draft) => ({
          ...draft,
          credentials: [{ kind: 'password', username: 'alice', password: 'hunter2' }],
        })),
        updateSitePayload('payload-key-b', keyB, (draft) => ({
          ...draft,
          credentials: [{ kind: 'passkey', rpId: 'b.example', credentialId: 'cred-id' }],
        })),
      ]);

      expect((await readSitePayload('payload-key-a', keyA)).credentials).toHaveLength(1);
      expect((await readSitePayload('payload-key-b', keyB)).credentials).toHaveLength(1);
    });
  });
});
