// Session-only state: which origins has the content script reported a
// form on, this browser session. Backed entirely by chrome.storage.session
// (RAM-only, cleared on browser restart) -- never an in-memory Map or
// module-level variable, because the background service worker can be
// killed after ~30s idle (MV3) and a real, shipped Attestto bug came from
// exactly that assumption (docs/research/attestto-teardown.md §3/§8.3).
// A restart between two messages is invisible to correctness here: every
// read/write goes through storage.
//
// `session:` (not `local:`) is deliberate -- this is this-session's data,
// not a permanent record. A permanent per-site history is Phase 4's
// Privacy Ledger, not this.

import { browser } from 'wxt/browser';
import type { CanonicalOrigin } from '../../shared/origin';

const SESSION_STORAGE_KEY = 'if_session_state_v1';

export interface OriginFormRecord {
  formCount: number;
  lastDetectedAt: number; // epoch ms
}

export interface SessionState {
  originForms: Record<string, OriginFormRecord>; // keyed by CanonicalOrigin
}

const EMPTY_STATE: SessionState = { originForms: {} };

export async function getSessionState(): Promise<SessionState> {
  const stored = await browser.storage.session.get(SESSION_STORAGE_KEY);
  return (stored[SESSION_STORAGE_KEY] as SessionState | undefined) ?? EMPTY_STATE;
}

export async function recordFormDetection(
  origin: CanonicalOrigin,
  formCount: number,
  detectedAt: number,
): Promise<void> {
  const state = await getSessionState();
  state.originForms[origin] = { formCount, lastDetectedAt: detectedAt };
  await browser.storage.session.set({ [SESSION_STORAGE_KEY]: state });
}
