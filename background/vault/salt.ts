// FixedAppSalt: 32 CSPRNG bytes, generated once at first call, persisted
// base64-encoded in browser.storage.local under `if_vault_salt_v1`, NEVER
// regenerated after creation (ADR-010 decision 2 -- regenerating it would
// silently change every future HKDF output with no error, looking exactly
// like "my accounts are gone").
//
// Every read and the one write (setFixedAppSalt, M7) share a single
// serializing queue (createSerialQueue, matching storage.ts/setup.ts's own
// use of it) -- NOT just a one-shot in-flight-promise memo, which is what
// this module used before M7. A /code-review finding caught a real gap in
// that earlier design: getOrCreateFixedAppSalt() is called from
// background/vault/unlock.ts's unlockVault() too, entirely outside
// setup.ts's own firstVaultWriteQueue -- a VAULT_UNLOCK message racing a
// RESTORE_VAULT_BACKUP on a device with no vault yet could have unlockVault
// generate-and-persist a fresh random salt that lands AFTER
// restoreNewVault's setFixedAppSalt() call, silently overwriting the
// correct backed-up salt with a wrong one. Centralizing the queue here,
// rather than only in setup.ts, closes that gap regardless of which module
// calls in -- any caller of getOrCreateFixedAppSalt/setFixedAppSalt is now
// serialized against every other one.
//
// The resolved value is still cached in memory (cachedSalt below) -- safe
// specifically because this value never changes for the lifetime of the
// vault (unlike vault DATA, which does), so there is no staleness risk once
// set. The fast path (an already-cached read) skips the queue entirely, so
// this doesn't reintroduce the extra-round-trip cost a /code-review finding
// on M5 fixed by adding the cache in the first place.

import { browser } from 'wxt/browser';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import { randomBytes } from './crypto';
import { createSerialQueue } from './serialQueue';

const SALT_STORAGE_KEY = 'if_vault_salt_v1';

let cachedSalt: Uint8Array | null = null;
const enqueueSaltOp = createSerialQueue();

export function getOrCreateFixedAppSalt(): Promise<Uint8Array> {
  if (cachedSalt) return Promise.resolve(cachedSalt);
  return enqueueSaltOp(async () => {
    // Re-checked inside the queue: another queued read (or setFixedAppSalt)
    // may have already resolved this while this call was waiting its turn.
    if (cachedSalt) return cachedSalt;
    const stored = await browser.storage.local.get(SALT_STORAGE_KEY);
    const existing = stored[SALT_STORAGE_KEY];
    if (typeof existing === 'string') {
      cachedSalt = base64ToBytes(existing);
      return cachedSalt;
    }
    const salt = randomBytes(32);
    await browser.storage.local.set({ [SALT_STORAGE_KEY]: bytesToBase64(salt) });
    cachedSalt = salt;
    return salt;
  });
}

// Restore-only escape hatch from the "never regenerate" rule above (M7).
// Normal operation must NEVER call this -- only background/vault/setup.ts's
// restoreNewVault does, to install a backed-up salt so future Service
// Identity derivations on this device reproduce the SAME keys the backup
// was made from. Goes through the same queue as getOrCreateFixedAppSalt --
// see the module header comment for the race this closes.
export function setFixedAppSalt(salt: Uint8Array): Promise<void> {
  return enqueueSaltOp(async () => {
    await browser.storage.local.set({ [SALT_STORAGE_KEY]: bytesToBase64(salt) });
    cachedSalt = salt;
  });
}
