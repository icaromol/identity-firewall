// createRootIdentity generates a fresh vault; persistNewVault is the shared
// tail (derive key -> initializeVaultData -> persist unlock metadata -> cache
// key) M7's restoreVaultBackup will call with a RESTORED VaultData instead of
// a fresh one -- factored out now so that milestone doesn't need to
// duplicate this logic.

import { bytesToBase64 } from '../../shared/bytes';
import type { UnlockInput } from '../../shared/messages';
import type { VaultData } from '../../shared/vault-schema';
import { generateAesGcmKeyFromBits } from './crypto';
import { DEFAULT_ARGON2_PARAMS, deriveVaultUnlockKey, generateRootSecret } from './keys';
import { getOrCreateFixedAppSalt } from './salt';
import { initializeVaultData, setCachedUnlockKey, setUnlockMethodMetadata } from './storage';

export async function persistNewVault(
  vaultData: VaultData,
  unlockInput: UnlockInput,
): Promise<void> {
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  // DEFAULT_ARGON2_PARAMS is passed unconditionally -- deriveVaultUnlockKey
  // simply ignores it on the passkey branch, and this avoids re-evaluating
  // `unlockInput.unlockMethod === 'passphrase'` a second time below with an
  // independently-typed-out DEFAULT_ARGON2_PARAMS reference that could drift
  // out of sync with this one (a real /code-review finding).
  const bits = await deriveVaultUnlockKey(unlockInput, fixedAppSalt, DEFAULT_ARGON2_PARAMS);
  const key = await generateAesGcmKeyFromBits(bits);

  // initializeVaultData is the FIRST persistent write and the only one
  // atomically guarded (via M3's write-queue) against double-creation.
  // Nothing below is written until this succeeds, so a losing racer/retry
  // can never stomp an existing vault's unlock metadata or cache.
  await initializeVaultData(vaultData, key);

  // setUnlockMethodMetadata writes the method and its matching
  // credential/params in ONE storage call -- see its own comment in
  // storage.ts for why (a /code-review finding: writing them as two
  // sequential calls left a window where an interrupted setup could
  // persist a method with no matching credential, permanently stranding
  // the vault since a retry throws VaultAlreadyInitializedError).
  await setUnlockMethodMetadata(
    unlockInput.unlockMethod === 'passphrase'
      ? { method: 'passphrase', argon2Params: DEFAULT_ARGON2_PARAMS }
      : { method: 'passkey', credentialId: unlockInput.credentialId },
  );
  await setCachedUnlockKey(bits);
}

export async function createRootIdentity(unlockInput: UnlockInput): Promise<void> {
  const rootSecret = generateRootSecret();
  const vaultData: VaultData = {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: bytesToBase64(rootSecret), createdAt: Date.now() },
    personalData: {},
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
  };
  await persistNewVault(vaultData, unlockInput);
}
