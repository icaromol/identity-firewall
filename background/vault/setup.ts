// createRootIdentity generates a fresh vault index; persistNewVault is the
// shared tail (derive key -> initialize index + empty personal-data blob ->
// persist unlock metadata -> cache key), reused by restoreNewVault below
// with a RESTORED VaultIndex instead of a fresh one -- factored out in M4
// (and adapted for the vault storage tiering refactor, ADR-015) so restore
// doesn't need to duplicate this logic.
//
// No site payloads are created here -- those come later, lazily, on first
// credential/alias save for a given origin (identity/storage.ts's
// createServiceIdentity, vault tiering refactor Step 5).
//
// restoreNewVault's OWN restore of real personal data and real site
// payloads (from a decrypted backup bundle) is deliberately NOT handled
// here -- writeNewVault below always initializes an EMPTY personal-data
// blob for both entry points, and restoreVaultBackup (background/vault/
// export.ts) re-partitioning a real backup bundle into all three tiers is
// the vault tiering refactor's own Step 7, not this one.
//
// firstVaultWriteQueue (M7): persistNewVault and restoreNewVault are BOTH
// "the first thing ever written to this vault" -- storage.ts's own
// per-tier write-queues only serialize each tier's BLOB write itself, not
// the salt read/write that happens before it. Without a wider queue here, a
// concurrent createRootIdentity and restoreVaultBackup could both pass
// restoreNewVault's vaultIndexExists() check while nothing exists yet, both
// touch FixedAppSalt, and end up pairing one call's index with the OTHER
// call's salt -- silently, since AES-GCM encryption never fails regardless
// of which salt was used to derive the key. The only symptom would be every
// future Service Identity derivation producing a wrong keypair, forever,
// with no error anywhere (a Plan agent's finding). This queue closes that
// gap by serializing the ENTIRE first-write sequence -- salt install
// included -- for both entry points against each other.
import { bytesToBase64 } from '../../shared/bytes';
import type { UnlockInput } from '../../shared/messages';
import type { VaultIndex } from '../../shared/vault-schema';
import { generateAesGcmKeyFromBits } from './crypto';
import { DEFAULT_ARGON2_PARAMS, deriveVaultUnlockKey, generateRootSecret } from './keys';
import { getOrCreateFixedAppSalt, setFixedAppSalt } from './salt';
import { createSerialQueue } from './serialQueue';
import {
  initializePersonalDataBlob,
  initializeVaultIndex,
  setCachedUnlockKey,
  setUnlockMethodMetadata,
  VaultAlreadyInitializedError,
  vaultIndexExists,
} from './storage';

const enqueueFirstVaultWrite = createSerialQueue();

async function writeNewVault(index: VaultIndex, unlockInput: UnlockInput): Promise<void> {
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  // DEFAULT_ARGON2_PARAMS is passed unconditionally -- deriveVaultUnlockKey
  // simply ignores it on the passkey branch, and this avoids re-evaluating
  // `unlockInput.unlockMethod === 'passphrase'` a second time below with an
  // independently-typed-out DEFAULT_ARGON2_PARAMS reference that could drift
  // out of sync with this one (a real /code-review finding).
  const bits = await deriveVaultUnlockKey(unlockInput, fixedAppSalt, DEFAULT_ARGON2_PARAMS);
  const key = await generateAesGcmKeyFromBits(bits);

  // initializeVaultIndex is the FIRST persistent write and the only one
  // atomically guarded (via storage.ts's own write-queue) against double-
  // creation. Nothing below is written until this succeeds, so a losing
  // racer/retry can never stomp an existing vault's unlock metadata or cache.
  await initializeVaultIndex(index, key);
  await initializePersonalDataBlob({}, key);

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

export function persistNewVault(index: VaultIndex, unlockInput: UnlockInput): Promise<void> {
  return enqueueFirstVaultWrite(() => writeNewVault(index, unlockInput));
}

export function createRootIdentity(unlockInput: UnlockInput): Promise<void> {
  const rootSecret = generateRootSecret();
  const index: VaultIndex = {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: bytesToBase64(rootSecret), createdAt: Date.now() },
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
  };
  return persistNewVault(index, unlockInput);
}

// M7: the vaultIndexExists() check and the FixedAppSalt install run INSIDE
// the same serialized section as writeNewVault, not as separate enqueue
// calls -- otherwise a concurrent createRootIdentity/restoreVaultBackup
// could still interleave between them even with the queue above (checking
// then queuing is not the same as queuing then checking). Checked BEFORE
// touching FixedAppSalt specifically: persistNewVault's own
// initializeVaultIndex call would also reject an already-initialized vault,
// but only AFTER this function would already have overwritten FixedAppSalt,
// corrupting an existing installation's Service Identity derivation with no
// way back.
export function restoreNewVault(
  index: VaultIndex,
  fixedAppSalt: Uint8Array,
  unlockInput: UnlockInput,
): Promise<void> {
  return enqueueFirstVaultWrite(async () => {
    if (await vaultIndexExists()) {
      throw new VaultAlreadyInitializedError();
    }
    await setFixedAppSalt(fixedAppSalt);
    await writeNewVault(index, unlockInput);
  });
}
