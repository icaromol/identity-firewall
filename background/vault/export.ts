// Backup export/restore (M7, ADR-013's BackupExportKey; re-partitioned
// across the three tiers by the vault storage tiering refactor, ADR-015).
// exportVaultBackup gathers the index, personal-data blob, and every site's
// Tier 3 payload into one flat plaintext bundle, plus the CURRENT
// FixedAppSalt -- omitting the salt would let restoreVaultBackup reproduce
// RootSecret correctly but silently derive the WRONG Service Identities
// AND the wrong site-payload keys on the new device (both
// deriveServiceIdentityKeypair and deriveSitePayloadKey are salted with
// FixedAppSalt, not just rootSecret), a correctness bug indistinguishable
// from data loss.
//
// restoreVaultBackup decrypts and validates the bundle FIRST, entirely
// before any write -- a wrong backupPassphrase or corrupted bundle must
// fail with zero side effects, which AES-GCM's own tag check gives for
// free (left unwrapped, exactly like decryptVaultDataWithKey's own
// precedent). The actual write -- including the vaultIndexExists() guard,
// the FixedAppSalt install, and every tier's write -- lives in setup.ts's
// restoreNewVault, not here, so it can be serialized against
// createRootIdentity/persistNewVault through the SAME queue (see setup.ts's
// header comment for the race this closes).

import { z } from 'zod';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import type { UnlockInput, VaultBackupBundle } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import {
  PersonalDataSchema,
  type ServiceIdentityMeta,
  SitePayloadSchema,
  VaultIndexSchema,
} from '../../shared/vault-schema';
import { decryptBlob, encryptBlob, randomBytes } from './crypto';
import { DEFAULT_ARGON2_PARAMS, deriveBackupExportKey } from './keys';
import { getOrCreateFixedAppSalt } from './salt';
import { restoreNewVault, type SitePayloadToWrite } from './setup';
import { deriveSitePayloadKey } from './siteKey';
import { readPersonalDataBlob, readSitePayload, readVaultIndex } from './storage';

const ARGON2_SALT_BYTE_LENGTH = 32; // matches FixedAppSalt's own length, no independent reasoning needed for a different size

// The bundle's DECRYPTED plaintext shape -- never crosses the message-
// passing boundary in this form (only the encrypted VaultBackupBundle
// does), so it's validated here rather than in shared/vault-schema.ts
// alongside the wire types. sitePayloads is keyed by origin, not the
// original device's payloadStorageKey -- that value is regenerated fresh
// on restore (setup.ts's SitePayloadToWrite), so there's no reason to carry
// the old one across at all. The byte-length refine on fixedAppSaltB64
// turns a corrupted/hand-edited backup into a clear parse failure instead
// of a salt of the wrong length silently reaching HKDF.
const VaultBackupPayloadSchema = z.object({
  index: VaultIndexSchema,
  personalData: PersonalDataSchema,
  sitePayloads: z.record(z.string(), SitePayloadSchema),
  fixedAppSaltB64: z.string().refine(
    (s) => {
      try {
        return base64ToBytes(s).length === 32;
      } catch {
        return false;
      }
    },
    { message: 'fixedAppSaltB64 must decode to exactly 32 bytes' },
  ),
});

export async function exportVaultBackup(backupPassphrase: string): Promise<VaultBackupBundle> {
  const [index, personalData, fixedAppSalt] = await Promise.all([
    readVaultIndex(),
    readPersonalDataBlob(),
    getOrCreateFixedAppSalt(),
  ]);
  const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);

  const sitePayloadEntries = await Promise.all(
    Object.values(index.serviceIdentities).map(async (meta: ServiceIdentityMeta) => {
      const origin = normalizeOrigin(meta.origin);
      const siteKey = await deriveSitePayloadKey(rootSecret, origin);
      const payload = await readSitePayload(meta.payloadStorageKey, siteKey);
      return [meta.origin, payload] as const;
    }),
  );
  const sitePayloads = Object.fromEntries(sitePayloadEntries);

  const argon2Salt = randomBytes(ARGON2_SALT_BYTE_LENGTH); // fresh per export, independent of FixedAppSalt (ADR-013)
  const key = await deriveBackupExportKey(backupPassphrase, argon2Salt, DEFAULT_ARGON2_PARAMS);

  const payload = {
    index,
    personalData,
    sitePayloads,
    fixedAppSaltB64: bytesToBase64(fixedAppSalt),
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const { iv, ciphertext } = await encryptBlob(key, plaintext);

  return {
    formatVersion: 1,
    kdf: 'argon2id',
    kdfParams: DEFAULT_ARGON2_PARAMS,
    argon2SaltB64: bytesToBase64(argon2Salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(ciphertext),
  };
}

export async function restoreVaultBackup(
  bundle: VaultBackupBundle,
  backupPassphrase: string,
  newUnlockInput: UnlockInput,
): Promise<void> {
  const argon2Salt = base64ToBytes(bundle.argon2SaltB64);
  const key = await deriveBackupExportKey(backupPassphrase, argon2Salt, bundle.kdfParams);
  const plaintext = await decryptBlob(
    key,
    base64ToBytes(bundle.ivB64),
    base64ToBytes(bundle.ciphertextB64),
  );
  const { index, personalData, sitePayloads, fixedAppSaltB64 } = VaultBackupPayloadSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );

  // Regenerate payloadStorageKey per origin -- the original device's values
  // are meaningless on this device (ADR-015, vault tiering refactor Step 7).
  // Built here, entirely from already-decrypted/validated data, before any
  // write -- restoreNewVault's own queue is what actually serializes the
  // write against a concurrent createRootIdentity, not this step.
  const restoredServiceIdentities = Object.fromEntries(
    Object.entries(index.serviceIdentities).map(([origin, meta]) => [
      origin,
      { ...meta, payloadStorageKey: crypto.randomUUID() },
    ]),
  );

  const sitePayloadsToWrite: SitePayloadToWrite[] = Object.entries(restoredServiceIdentities).map(
    ([origin, meta]) => {
      const payload = sitePayloads[origin];
      if (!payload) {
        throw new Error(`Corrupted backup: no site payload found for origin "${origin}"`);
      }
      return { payloadStorageKey: meta.payloadStorageKey, payload };
    },
  );

  await restoreNewVault(
    { ...index, serviceIdentities: restoredServiceIdentities },
    personalData,
    sitePayloadsToWrite,
    base64ToBytes(fixedAppSaltB64),
    newUnlockInput,
  );
}
