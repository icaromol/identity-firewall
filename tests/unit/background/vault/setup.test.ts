import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { randomBytes } from '../../../../background/vault/crypto';
import { createRootIdentity, persistNewVault } from '../../../../background/vault/setup';
import {
  getCachedUnlockKey,
  getConfiguredUnlockMethod,
  getPassphraseArgon2Params,
  readVaultData,
  VaultAlreadyInitializedError,
} from '../../../../background/vault/storage';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { UnlockInput } from '../../../../shared/messages';
import type { VaultData } from '../../../../shared/vault-schema';

const passkeyInput: UnlockInput = {
  unlockMethod: 'passkey',
  prfOutputB64: bytesToBase64(randomBytes(32)),
  credentialId: 'fixture-credential-id',
  rpId: 'chrome-extension://fixture-extension-id',
};

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('createRootIdentity', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('creates a vault via the passkey path and leaves it unlocked', async () => {
    await createRootIdentity(passkeyInput);

    expect(await getCachedUnlockKey()).not.toBeNull();
    expect(await getConfiguredUnlockMethod()).toBe('passkey');

    const data = await readVaultData();
    expect(data.schemaVersion).toBe(1);
    expect(data.rootIdentity.rootSecretB64).toEqual(expect.any(String));
  });

  it('creates a vault via the passphrase path and leaves it unlocked', async () => {
    await createRootIdentity(passphraseInput);

    expect(await getCachedUnlockKey()).not.toBeNull();
    expect(await getConfiguredUnlockMethod()).toBe('passphrase');
    expect(await getPassphraseArgon2Params()).toBeDefined();

    const data = await readVaultData();
    expect(data.schemaVersion).toBe(1);
  });

  it('throws VaultAlreadyInitializedError on a second call and leaves the first vault untouched', async () => {
    await createRootIdentity(passphraseInput);
    const paramsBefore = await getPassphraseArgon2Params();
    const methodBefore = await getConfiguredUnlockMethod();

    await expect(createRootIdentity(passkeyInput)).rejects.toThrow(VaultAlreadyInitializedError);

    // The ordering invariant: initializeVaultData's guard fires before any
    // unlock-metadata write, so a rejected second call must never have
    // touched the first vault's already-persisted metadata or cached key.
    expect(await getConfiguredUnlockMethod()).toBe(methodBefore);
    expect(await getPassphraseArgon2Params()).toEqual(paramsBefore);
    expect(await getCachedUnlockKey()).not.toBeNull();
  });
});

describe('persistNewVault', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('persists a caller-provided VaultData (standing in for a future restored backup)', async () => {
    const providedVaultData: VaultData = {
      schemaVersion: 1,
      rootIdentity: { rootSecretB64: bytesToBase64(randomBytes(32)), createdAt: 12345 },
      personalData: { email: 'alice@example.com' },
      serviceIdentities: {},
      aliasProviderConfig: { provider: 'none' },
      policies: [],
      privacyLedger: [],
    };

    await persistNewVault(providedVaultData, passphraseInput);

    const data = await readVaultData();
    expect(data).toEqual(providedVaultData);
  });
});
