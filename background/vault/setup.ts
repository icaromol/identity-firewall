// createRootIdentity generates a fresh vault index; persistNewVault is the
// shared tail (derive key -> initialize index + personal-data blob + any
// site payloads -> persist unlock metadata -> cache key), reused by
// restoreNewVault below with RESTORED trees instead of fresh/empty ones --
// factored out in M4 (and adapted for the vault storage tiering refactor,
// ADR-015) so restore doesn't need to duplicate this logic.
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
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import type { UnlockInput } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import type { PersonalData, SitePayload, VaultIndex } from '../../shared/vault-schema';
import { generateAesGcmKeyFromBits } from './crypto';
import { DEFAULT_ARGON2_PARAMS, deriveVaultUnlockKey, generateRootSecret } from './keys';
import { getOrCreateFixedAppSalt, setFixedAppSalt } from './salt';
import { createSerialQueue } from './serialQueue';
import { deriveSitePayloadKey } from './siteKey';
import {
  initializePersonalDataBlob,
  initializeSitePayload,
  initializeVaultIndex,
  setCachedUnlockKey,
  setUnlockMethodMetadata,
  VaultAlreadyInitializedError,
  vaultIndexExists,
} from './storage';

const enqueueFirstVaultWrite = createSerialQueue();

// One entry per origin being restored, with a FRESHLY-minted
// payloadStorageKey -- the original device's values are meaningless on this
// device (ADR-015, vault tiering refactor Step 7). `payload.origin` already
// carries the origin (SitePayloadSchema's own redundant field), so no
// separate origin field is needed here.
export interface SitePayloadToWrite {
  payloadStorageKey: string;
  payload: SitePayload;
}

async function writeNewVault(
  index: VaultIndex,
  unlockInput: UnlockInput,
  personalData: PersonalData,
  sitePayloadsToWrite: SitePayloadToWrite[],
): Promise<void> {
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
  await initializePersonalDataBlob(personalData, key);

  // Site payloads are keyed by their OWN derived key (never the vault
  // unlock key `key` above) -- deriveSitePayloadKey needs RootSecret, which
  // this `index` already carries (freshly generated for createRootIdentity,
  // or restored for restoreNewVault). Empty for the fresh-setup path
  // (createRootIdentity never has any yet -- those come later, lazily, on
  // first credential/alias save, identity/storage.ts's createServiceIdentity).
  const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);
  await Promise.all(
    sitePayloadsToWrite.map(async ({ payloadStorageKey, payload }) => {
      const siteKey = await deriveSitePayloadKey(rootSecret, normalizeOrigin(payload.origin));
      await initializeSitePayload(payloadStorageKey, payload, siteKey);
    }),
  );

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
  return enqueueFirstVaultWrite(() => writeNewVault(index, unlockInput, {}, []));
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
    highTrustOrigins: [],
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
  personalData: PersonalData,
  sitePayloadsToWrite: SitePayloadToWrite[],
  fixedAppSalt: Uint8Array,
  unlockInput: UnlockInput,
): Promise<void> {
  return enqueueFirstVaultWrite(async () => {
    if (await vaultIndexExists()) {
      throw new VaultAlreadyInitializedError();
    }
    await setFixedAppSalt(fixedAppSalt);
    await writeNewVault(index, unlockInput, personalData, sitePayloadsToWrite);
  });
}
