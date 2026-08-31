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
import type { ClassifiedForm } from '../firewall/classifier';

const SESSION_STORAGE_KEY = 'if_session_state_v1';

// forms holds the classified structure (Phase 3), not just a count --
// formCount is derived from forms.length wherever it's still needed
// (GET_SESSION_STATE/GET_ORIGIN_STATE's existing response shapes), rather
// than stored separately and risking the two drifting apart.
//
// askCount (Phase 5 M4) is the one exception to that rule -- it's a
// genuinely separate, more expensive computation (requires decrypting
// PersonalData and reading Policies, via background/badge.ts's
// tryLoadAutoApplyInputs) that handleFormDetected already has to do once,
// for its own auto-apply side effects. Caching the result here lets
// background/badge.ts's updateBadgeForTab -- now also called from
// FORM_SUBMITTED/CONFIRM/DISCARD_PENDING_CREDENTIAL, none of which change
// which fields are recognized or how policy resolves them -- read a
// number instead of re-decrypting the vault on every one of those calls
// just to refresh a toolbar badge (a /code-review finding).
export interface OriginFormRecord {
  forms: ClassifiedForm[];
  lastDetectedAt: number; // epoch ms
  askCount: number;
}

export interface SessionState {
  originForms: Record<string, OriginFormRecord>; // keyed by CanonicalOrigin
}

export async function getSessionState(): Promise<SessionState> {
  const stored = await browser.storage.session.get(SESSION_STORAGE_KEY);
  return (stored[SESSION_STORAGE_KEY] as SessionState | undefined) ?? { originForms: {} };
}

// recordFormDetection's read-modify-write against storage.session is not
// atomic on its own, so concurrent calls (e.g. two tabs reporting forms
// near-simultaneously) are serialized through this in-memory queue --
// each call waits for the previous call's storage write to finish before
// reading. This is safe across a service-worker restart: the queue holds
// no state that correctness depends on, it only orders writes that happen
// while a single worker instance is alive; if the worker is killed
// mid-write, there is nothing pending to lose track of.
let writeQueue: Promise<void> = Promise.resolve();

export function recordFormDetection(
  origin: CanonicalOrigin,
  forms: ClassifiedForm[],
  detectedAt: number,
  askCount: number,
): Promise<void> {
  const result = writeQueue.then(async () => {
    const state = await getSessionState();
    state.originForms[origin] = { forms, lastDetectedAt: detectedAt, askCount };
    await browser.storage.session.set({ [SESSION_STORAGE_KEY]: state });
  });
  writeQueue = result.catch(() => {});
  return result;
}
