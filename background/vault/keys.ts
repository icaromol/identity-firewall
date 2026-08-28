// Semantic wrappers implementing the three-key hierarchy (ADR-013):
// VaultUnlockKey (ephemeral, derived per-unlock), RootSecret (persistent
// CSPRNG value, HKDF ikm for every Service Identity per ADR-010),
// BackupExportKey (derived per export). See ADR-012 for why the vault-unlock
// path branches on unlockMethod, and why FixedAppSalt is safely reused as the
// Argon2id salt for the passphrase path: domain separation comes from each
// derivation using a different `ikm` and/or `info`/`personalization`, not
// from salt secrecy -- FixedAppSalt's only job is uniqueness-per-installation.

import { argon2idAsync } from '@noble/hashes/argon2.js';
import { base64ToBytes } from '../../shared/bytes';
import type { UnlockInput } from '../../shared/messages';
import type { Argon2Params } from '../../shared/vault-schema';
import { deriveHkdfBits, generateAesGcmKeyFromBits, randomBytes } from './crypto';

// OWASP 2024 interactive-use baseline (matches Attestto's own validated
// starting parameters, per docs/plans/phase-2-local-identity-vault.md's
// decision 3). Callers should not hardcode these directly -- pass through
// RootIdentitySchema.passphraseArgon2Params once a vault exists, so a future
// retuning of this constant never strands an existing vault (ADR-012).
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { t: 2, m: 19456, p: 1 };

const PASSKEY_UNLOCK_INFO = new TextEncoder().encode('identity-firewall:vault-unlock:passkey:v1');
const PASSPHRASE_UNLOCK_PERSONALIZATION = new TextEncoder().encode(
  'identity-firewall:vault-unlock:passphrase:v1',
);
const BACKUP_EXPORT_PERSONALIZATION = new TextEncoder().encode(
  'identity-firewall:backup-export:v1',
);

export async function deriveVaultUnlockKey(
  input: UnlockInput,
  fixedAppSalt: Uint8Array,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<CryptoKey> {
  if (input.unlockMethod === 'passkey') {
    const prfBytes = base64ToBytes(input.prfOutputB64);
    const bits = await deriveHkdfBits(prfBytes, fixedAppSalt, PASSKEY_UNLOCK_INFO, 256);
    return generateAesGcmKeyFromBits(bits);
  }
  const passwordBytes = new TextEncoder().encode(input.passphrase);
  const bits = await argon2idAsync(passwordBytes, fixedAppSalt, {
    ...argon2Params,
    dkLen: 32,
    personalization: PASSPHRASE_UNLOCK_PERSONALIZATION,
  });
  return generateAesGcmKeyFromBits(bits);
}

export function generateRootSecret(): Uint8Array {
  return randomBytes(32);
}

export async function deriveBackupExportKey(
  passphrase: string,
  argon2Salt: Uint8Array,
  argon2Params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(passphrase);
  const bits = await argon2idAsync(passwordBytes, argon2Salt, {
    ...argon2Params,
    dkLen: 32,
    personalization: BACKUP_EXPORT_PERSONALIZATION,
  });
  return generateAesGcmKeyFromBits(bits);
}
