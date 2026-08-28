// Backup export/restore (M7, ADR-013's BackupExportKey). exportVaultBackup
// encrypts the CURRENT VaultData plus the CURRENT FixedAppSalt together --
// omitting the salt would let restoreVaultBackup reproduce RootSecret
// correctly but silently derive the WRONG Service Identities on the new
// device (every deriveServiceIdentityKeypair call is salted with
// FixedAppSalt, not just rootSecret -- see identity/derive.ts), a
// correctness bug indistinguishable from data loss.
//
// restoreVaultBackup decrypts and validates the bundle FIRST, entirely
// before any write -- a wrong backupPassphrase or corrupted bundle must
// fail with zero side effects, which AES-GCM's own tag check gives for
// free (left unwrapped, exactly like decryptVaultDataWithKey's own
// precedent). The actual write -- including the vaultBlobExists() guard and
// the FixedAppSalt install -- lives in setup.ts's restoreNewVault, not
// here, so it can be serialized against createRootIdentity/persistNewVault
// through the SAME queue (see setup.ts's header comment for the race this
// closes).

import { z } from 'zod';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import type { UnlockInput, VaultBackupBundle } from '../../shared/messages';
import { VaultDataSchema } from '../../shared/vault-schema';
import { decryptBlob, encryptBlob, randomBytes } from './crypto';
import { DEFAULT_ARGON2_PARAMS, deriveBackupExportKey } from './keys';
import { getOrCreateFixedAppSalt } from './salt';
import { restoreNewVault } from './setup';
import { readVaultData } from './storage';

const ARGON2_SALT_BYTE_LENGTH = 32; // matches FixedAppSalt's own length, no independent reasoning needed for a different size

// The bundle's DECRYPTED plaintext shape -- never crosses the message-
// passing boundary in this form (only the encrypted VaultBackupBundle
// does), so it's validated here rather than in shared/vault-schema.ts
// alongside the wire types. The byte-length refine on fixedAppSaltB64 turns
// a corrupted/hand-edited backup into a clear parse failure instead of a
// salt of the wrong length silently reaching HKDF.
const VaultBackupPayloadSchema = z.object({
  vaultData: VaultDataSchema,
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
  const [vaultData, fixedAppSalt] = await Promise.all([readVaultData(), getOrCreateFixedAppSalt()]);

  const argon2Salt = randomBytes(ARGON2_SALT_BYTE_LENGTH); // fresh per export, independent of FixedAppSalt (ADR-013)
  const key = await deriveBackupExportKey(backupPassphrase, argon2Salt, DEFAULT_ARGON2_PARAMS);

  const payload = { vaultData, fixedAppSaltB64: bytesToBase64(fixedAppSalt) };
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
  const { vaultData, fixedAppSaltB64 } = VaultBackupPayloadSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );

  await restoreNewVault(vaultData, base64ToBytes(fixedAppSaltB64), newUnlockInput);
}
