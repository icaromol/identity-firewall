// FixedAppSalt: 32 CSPRNG bytes, generated once at first call, persisted
// base64-encoded in browser.storage.local under `if_vault_salt_v1`, NEVER
// regenerated after creation (ADR-010 decision 2 -- regenerating it would
// silently change every future HKDF output with no error, looking exactly
// like "my accounts are gone").
//
// Race-safety uses a one-shot in-flight-promise memo, not
// background/session/state.ts's serializing write-queue -- that queue solves
// repeated read-modify-write cycles for a value that changes on every call;
// this value is generated at most once, ever, so a lighter pattern suffices.

import { browser } from 'wxt/browser';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import { randomBytes } from './crypto';

const SALT_STORAGE_KEY = 'if_vault_salt_v1';

let inFlight: Promise<Uint8Array> | null = null;

export async function getOrCreateFixedAppSalt(): Promise<Uint8Array> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const stored = await browser.storage.local.get(SALT_STORAGE_KEY);
    const existing = stored[SALT_STORAGE_KEY];
    if (typeof existing === 'string') {
      return base64ToBytes(existing);
    }
    const salt = randomBytes(32);
    await browser.storage.local.set({ [SALT_STORAGE_KEY]: bytesToBase64(salt) });
    return salt;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
