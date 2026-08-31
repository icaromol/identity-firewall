// Phase 5 M4 -- stages a captured login per origin, in chrome.storage.session
// (never the encrypted vault) until the user explicitly confirms via the
// popup (design decision 6, docs/plans/phase-5-vault-completion.md).
// Mirrors background/session/state.ts's own conventions exactly: a single
// storage key, a serializing write queue for concurrent read-modify-write
// safety across a possible service-worker restart mid-write, and RAM-only
// (session:) storage -- an unconfirmed capture that's never opened simply
// ages out with everything else when the browser restarts, not a permanent
// record.

import { browser } from 'wxt/browser';
import type { PendingCredential } from '../../../shared/messages';
import type { CanonicalOrigin } from '../../../shared/origin';

const PENDING_CREDENTIAL_STORAGE_KEY = 'if_pending_credentials_v1';

interface PendingCredentialState {
  byOrigin: Record<string, PendingCredential>;
}

async function readState(): Promise<PendingCredentialState> {
  const stored = await browser.storage.session.get(PENDING_CREDENTIAL_STORAGE_KEY);
  return (
    (stored[PENDING_CREDENTIAL_STORAGE_KEY] as PendingCredentialState | undefined) ?? {
      byOrigin: {},
    }
  );
}

// Same single in-memory queue pattern as session/state.ts's writeQueue --
// see that file's own header comment for why this is safe across a
// service-worker restart (the queue holds no state correctness depends
// on; it only orders writes made while one worker instance is alive).
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(
  mutate: (state: PendingCredentialState) => PendingCredentialState,
): Promise<void> {
  const result = writeQueue.then(async () => {
    const state = await readState();
    await browser.storage.session.set({ [PENDING_CREDENTIAL_STORAGE_KEY]: mutate(state) });
  });
  writeQueue = result.catch(() => {});
  return result;
}

export async function getPendingCredential(
  origin: CanonicalOrigin,
): Promise<PendingCredential | null> {
  const state = await readState();
  return state.byOrigin[origin] ?? null;
}

export function setPendingCredential(
  origin: CanonicalOrigin,
  credential: PendingCredential,
): Promise<void> {
  return enqueueWrite((state) => ({
    byOrigin: { ...state.byOrigin, [origin]: credential },
  }));
}

export function clearPendingCredential(origin: CanonicalOrigin): Promise<void> {
  return enqueueWrite((state) => {
    const { [origin]: _removed, ...rest } = state.byOrigin;
    return { byOrigin: rest };
  });
}
