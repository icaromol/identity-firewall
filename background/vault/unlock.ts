// The vault-unlock ceremony: unlockVault (verify an UnlockInput, cache the
// resulting key only on success), lockVault (clear the cache), and
// requireUnlocked (the guard every M4+ handler that needs decrypted content
// calls first). Imports only from storage.ts, keys.ts, and salt.ts -- never
// touches browser.storage.* directly itself.
//
// unlockVault verifies by decrypting the INDEX tier now, not the old
// whole-blob (ADR-015, vault tiering refactor Step 4) -- smaller and
// faster to decrypt, a nice side effect of the tiering refactor rather than
// something this function had to earn on its own.

import type { UnlockInput } from '../../shared/messages';
import type { VaultIndex } from '../../shared/vault-schema';
import { generateAesGcmKeyFromBits } from './crypto';
import { deriveVaultUnlockKey } from './keys';
import { getOrCreateFixedAppSalt } from './salt';
import {
  clearCachedUnlockKey,
  decryptVaultIndexWithKey,
  getPassphraseArgon2Params,
  readVaultIndex,
  setCachedUnlockKey,
} from './storage';

// Deliberately does not distinguish "wrong passphrase" from "passphrase-
// unlock never configured for this vault" as separate error cases -- when
// never configured, getPassphraseArgon2Params() returns undefined and
// deriveVaultUnlockKey falls back to its own DEFAULT_ARGON2_PARAMS, and the
// resulting key fails AES-GCM's authentication tag exactly the same way a
// genuinely wrong passphrase would. The two cases are cryptographically
// indistinguishable from decrypt's point of view by construction (ADR-012).
export async function unlockVault(input: UnlockInput): Promise<VaultIndex> {
  // The two reads are independent -- run them concurrently rather than
  // paying two sequential browser.storage.local round-trips before the
  // (already expensive) Argon2id derivation even starts.
  const [fixedAppSalt, argon2Params] = await Promise.all([
    getOrCreateFixedAppSalt(),
    input.unlockMethod === 'passphrase' ? getPassphraseArgon2Params() : Promise.resolve(undefined),
  ]);
  const bits = await deriveVaultUnlockKey(input, fixedAppSalt, argon2Params);
  const key = await generateAesGcmKeyFromBits(bits);
  // Verify correctness BEFORE caching anything -- a wrong passphrase/PRF
  // output must never pollute the session cache with an unusable key.
  const index = await decryptVaultIndexWithKey(key);
  await setCachedUnlockKey(bits);
  return index;
}

export async function lockVault(): Promise<void> {
  await clearCachedUnlockKey();
}

// An alias, not a reimplementation -- requireUnlocked and storage.ts's own
// readVaultIndex are the exact same "get cached key, throw VaultLockedError
// if absent, decrypt" guard, now against the index tier. Delegating keeps
// there being exactly one implementation to keep correct. Confirmed unused
// by any real capability module (only this file's own test imports it) --
// kept as a documented, working alias anyway, matching its own prior
// history (M5/M6 already found it unused in favor of importing the
// underlying storage.ts function directly).
export const requireUnlocked = readVaultIndex;
