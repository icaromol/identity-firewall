import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { generateAesGcmKeyFromBits, randomBytes } from '../../../../background/vault/crypto';
import { deriveVaultUnlockKey } from '../../../../background/vault/keys';
import { getOrCreateFixedAppSalt } from '../../../../background/vault/salt';
import {
  getCachedUnlockKey,
  initializeVaultData,
  setPassphraseArgon2Params,
  VaultLockedError,
  VaultNotInitializedError,
  vaultBlobExists,
} from '../../../../background/vault/storage';
import { lockVault, requireUnlocked, unlockVault } from '../../../../background/vault/unlock';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { UnlockInput } from '../../../../shared/messages';
import type { VaultData } from '../../../../shared/vault-schema';

// Cheap params so unlockVault's Argon2id call stays fast in tests.
const CHEAP_ARGON2_PARAMS = { t: 1, m: 8, p: 1 };
const PASSPHRASE = 'correct horse battery staple';

function minimalVaultData(): VaultData {
  return {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    personalData: {},
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
  };
}

// Sets up a vault whose passphrase-unlock derivation matches what
// unlockVault(passphraseInput) will independently re-derive: same
// FixedAppSalt (read via getOrCreateFixedAppSalt, exactly as unlockVault
// does), same configured (cheap) Argon2 params, same passphrase.
async function setUpPassphraseVault(): Promise<void> {
  await setPassphraseArgon2Params(CHEAP_ARGON2_PARAMS);
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  const bits = await deriveVaultUnlockKey(
    { unlockMethod: 'passphrase', passphrase: PASSPHRASE },
    fixedAppSalt,
    CHEAP_ARGON2_PARAMS,
  );
  const key = await generateAesGcmKeyFromBits(bits);
  await initializeVaultData(minimalVaultData(), key);
}

describe('unlockVault / lockVault / requireUnlocked', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('unlocks with the correct passkey UnlockInput and leaves a working cached key', async () => {
    const prfOutputB64 = bytesToBase64(randomBytes(32));
    const passkeyInput: UnlockInput = {
      unlockMethod: 'passkey',
      prfOutputB64,
      credentialId: 'Y3JlZA',
      rpId: 'example.com',
    };

    const fixedAppSalt = await getOrCreateFixedAppSalt();
    const bits = await deriveVaultUnlockKey(passkeyInput, fixedAppSalt);
    const key = await generateAesGcmKeyFromBits(bits);
    await initializeVaultData(minimalVaultData(), key);

    const data = await unlockVault(passkeyInput);
    expect(data.schemaVersion).toBe(1);
    expect(await getCachedUnlockKey()).not.toBeNull();
    expect(await requireUnlocked()).toEqual(data);
  });

  it('unlocks with the correct passphrase and leaves a working cached key', async () => {
    await setUpPassphraseVault();

    const data = await unlockVault({ unlockMethod: 'passphrase', passphrase: PASSPHRASE });
    expect(data.schemaVersion).toBe(1);

    expect(await getCachedUnlockKey()).not.toBeNull();
    expect(await requireUnlocked()).toEqual(data);
  });

  it('rejects a wrong passphrase and does not cache a key', async () => {
    await setUpPassphraseVault();

    const wrongInput: UnlockInput = { unlockMethod: 'passphrase', passphrase: 'wrong passphrase' };
    await expect(unlockVault(wrongInput)).rejects.toThrow();

    expect(await getCachedUnlockKey()).toBeNull();
  });

  it('throws VaultNotInitializedError when no vault exists yet', async () => {
    await setPassphraseArgon2Params(CHEAP_ARGON2_PARAMS);
    await expect(
      unlockVault({ unlockMethod: 'passphrase', passphrase: PASSPHRASE }),
    ).rejects.toThrow(VaultNotInitializedError);
  });

  it('lockVault clears the cache so requireUnlocked then throws VaultLockedError', async () => {
    await setUpPassphraseVault();
    await unlockVault({ unlockMethod: 'passphrase', passphrase: PASSPHRASE });

    await lockVault();

    await expect(requireUnlocked()).rejects.toThrow(VaultLockedError);
  });

  it('requireUnlocked throws VaultLockedError before any unlock has happened', async () => {
    await expect(requireUnlocked()).rejects.toThrow(VaultLockedError);
  });

  it('unlocks correctly using a non-default configured passphraseArgon2Params', async () => {
    // Distinct from CHEAP_ARGON2_PARAMS -- proves unlockVault actually reads
    // the per-vault configured params rather than always using
    // DEFAULT_ARGON2_PARAMS or the first cheap value it saw.
    const customParams = { t: 1, m: 16, p: 1 };
    await setPassphraseArgon2Params(customParams);
    const fixedAppSalt = await getOrCreateFixedAppSalt();
    const bits = await deriveVaultUnlockKey(
      { unlockMethod: 'passphrase', passphrase: PASSPHRASE },
      fixedAppSalt,
      customParams,
    );
    const key = await generateAesGcmKeyFromBits(bits);
    await initializeVaultData(minimalVaultData(), key);

    expect(await vaultBlobExists()).toBe(true);
    const data = await unlockVault({ unlockMethod: 'passphrase', passphrase: PASSPHRASE });
    expect(data.schemaVersion).toBe(1);
  });
});
