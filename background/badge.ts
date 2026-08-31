// Single source of truth for the toolbar badge -- Phase 4 set it entirely
// from within handleFormDetected's own loop, but Phase 5 M4 adds a SECOND
// independent trigger (a captured, unconfirmed credential) that also needs
// to change it. Two handlers computing and writing the badge independently
// is exactly the "two independently-invented definitions that can drift"
// shape a Phase 5 M3 code-review finding already flagged once for a
// different pair of modules -- this reads from one cached source
// (session/state.ts's own askCount, computed once by handleFormDetected)
// rather than each caller keeping its own partial view.

import { browser } from 'wxt/browser';
import { normalizeOrigin } from '../shared/origin';
import { getHighTrustOrigins, getPolicies } from './policy/storage';
import { getSessionState } from './session/state';
import { getPendingCredential } from './vault/credentials/pendingCapture';
import { getPersonalData } from './vault/personalData/storage';
import { readVaultIndex } from './vault/storage';

// Undefined when the vault is locked (or otherwise unreadable) -- every
// recognized field then falls back to counting as "needs the popup."
// Exported: handleFormDetected's own auto-apply side-effect loop (relaying
// AUTOFILL_FIELDS, recording disclosures) needs these same inputs.
export async function tryLoadAutoApplyInputs(): Promise<
  | {
      policies: Awaited<ReturnType<typeof getPolicies>>;
      personalData: Awaited<ReturnType<typeof getPersonalData>>;
      isHighTrustOrigin: (origin: string) => boolean;
      aliasProviderConfigured: boolean;
    }
  | undefined
> {
  try {
    const [policies, personalData, index, highTrustOrigins] = await Promise.all([
      getPolicies(),
      getPersonalData(),
      readVaultIndex(),
      getHighTrustOrigins(),
    ]);
    const normalizedHighTrust = new Set(highTrustOrigins.map((o) => normalizeOrigin(o)));
    return {
      policies,
      personalData,
      isHighTrustOrigin: (origin: string) => normalizedHighTrust.has(normalizeOrigin(origin)),
      aliasProviderConfigured: index.aliasProviderConfig.provider !== 'none',
    };
  } catch {
    return undefined;
  }
}

// Counts fields genuinely awaiting a decision (Phase 4 design decision 5,
// cached in session state by handleFormDetected -- see that record's own
// field comment for why) PLUS one more for a pending, unconfirmed captured
// credential (Phase 5 M4) -- a form entirely covered by policy AND nothing
// pending to save shows no badge at all. Deliberately does NOT re-decrypt
// the vault or re-run computeAutoApply itself: this is called from
// FORM_SUBMITTED/CONFIRM/DISCARD_PENDING_CREDENTIAL too, none of which
// change what's recognized on a page or how policy resolves it, so
// there's nothing here that needs redoing.
//
// Never throws -- a badge is cosmetic; a failure updating it (e.g. the
// tab closed a moment ago) must never turn an otherwise-successful save/
// discard/capture into a reported {ok:false} (a /code-review finding).
export async function updateBadgeForTab(tabId: number, origin: string): Promise<void> {
  try {
    const [sessionState, pending] = await Promise.all([
      getSessionState(),
      getPendingCredential(normalizeOrigin(origin)),
    ]);
    const askCount = sessionState.originForms[normalizeOrigin(origin)]?.askCount ?? 0;
    const total = askCount + (pending ? 1 : 0);
    await browser.action.setBadgeText({ tabId, text: total > 0 ? String(total) : '' });
  } catch (err) {
    console.debug('Identity Firewall: failed to update the toolbar badge', err);
  }
}
