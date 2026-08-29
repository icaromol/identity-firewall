import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { randomBytes } from '../../../../background/vault/crypto';
import { createRootIdentity, persistNewVault } from '../../../../background/vault/setup';
import {
  getCachedUnlockKey,
  getConfiguredUnlockMethod,
  getPassphraseArgon2Params,
  readPersonalDataBlob,
  readVaultIndex,
  VaultAlreadyInitializedError,
} from '../../../../background/vault/storage';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { UnlockInput } from '../../../../shared/messages';
import type { VaultIndex } from '../../../../shared/vault-schema';

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

    const index = await readVaultIndex();
    expect(index.schemaVersion).toBe(1);
    expect(index.rootIdentity.rootSecretB64).toEqual(expect.any(String));
    expect(await readPersonalDataBlob()).toEqual({});
  });

  it('creates a vault via the passphrase path and leaves it unlocked', async () => {
    await createRootIdentity(passphraseInput);

    expect(await getCachedUnlockKey()).not.toBeNull();
    expect(await getConfiguredUnlockMethod()).toBe('passphrase');
    expect(await getPassphraseArgon2Params()).toBeDefined();

    const index = await readVaultIndex();
    expect(index.schemaVersion).toBe(1);
  });

  it('throws VaultAlreadyInitializedError on a second call and leaves the first vault untouched', async () => {
    await createRootIdentity(passphraseInput);
    const paramsBefore = await getPassphraseArgon2Params();
    const methodBefore = await getConfiguredUnlockMethod();

    await expect(createRootIdentity(passkeyInput)).rejects.toThrow(VaultAlreadyInitializedError);

    // The ordering invariant: initializeVaultIndex's guard fires before any
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

  it('persists a caller-provided VaultIndex (standing in for a future restored backup)', async () => {
    const providedIndex: VaultIndex = {
      schemaVersion: 1,
      rootIdentity: { rootSecretB64: bytesToBase64(randomBytes(32)), createdAt: 12345 },
      serviceIdentities: {},
      aliasProviderConfig: { provider: 'none' },
      policies: [],
      privacyLedger: [],
      highTrustOrigins: [],
    };

    await persistNewVault(providedIndex, passphraseInput);

    const index = await readVaultIndex();
    expect(index).toEqual(providedIndex);
    // persistNewVault always initializes an EMPTY personal-data blob --
    // restoring REAL personal data from a backup is Step 7's job, not this
    // function's (see this file's own header comment for why).
    expect(await readPersonalDataBlob()).toEqual({});
  });
});
