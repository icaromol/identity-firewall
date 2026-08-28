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
//
// The resolved value is also cached in memory (cachedSalt below) -- safe
// specifically because this value never changes for the lifetime of the
// vault (unlike vault DATA, which does), so there is no staleness risk. A
// /code-review finding on M5 (the first caller to invoke this repeatedly in
// a tight sequence, once per Service Identity derivation) found every call
// was paying a fresh browser.storage.local.get() round trip for a value
// that can only ever be the same. The cache is naturally cleared on every
// MV3 service-worker restart, which is fine -- one extra read per worker
// lifetime, not per call.

import { browser } from 'wxt/browser';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import { randomBytes } from './crypto';

const SALT_STORAGE_KEY = 'if_vault_salt_v1';

let cachedSalt: Uint8Array | null = null;
let inFlight: Promise<Uint8Array> | null = null;

export async function getOrCreateFixedAppSalt(): Promise<Uint8Array> {
  if (cachedSalt) return cachedSalt;
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
    const salt = await inFlight;
    cachedSalt = salt;
    return salt;
  } finally {
    inFlight = null;
  }
}
