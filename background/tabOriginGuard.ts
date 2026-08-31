// Shared "the popup's cached tab/origin might be stale" guard. origin/
// tabId are typically captured once when the popup opens and cached in a
// Pinia store's state -- if the tab navigates to a different site while
// the popup stays open (a redirect, the user following a link) and the
// user then clicks a button that acts on that cached (origin, tabId)
// pair, the action must refuse rather than silently act against the
// WRONG site. tab.url comes back stripped/undefined once the 'activeTab'
// grant for that tab is revoked by navigation (see wxt.config.ts's own
// comment on that permission), which is exactly the signal this check
// needs: no visible url, no proof of origin, refuse.
//
// Originally written once for handleSubmitFieldDecisions
// (background/firewall/handler.ts, a Phase 3 code-review finding), then
// copy-pasted for handleSetHighTrustOrigin (background/policy/handler.ts)
// and handleConfirmPendingCredential (background/vault/credentials/
// handler.ts) -- consolidated here once a third independent copy showed
// up (a Phase 5 M4 code-review finding).

import { browser } from 'wxt/browser';
import { normalizeOrigin } from '../shared/origin';

export async function assertTabShowsOrigin(
  tabId: number,
  origin: string,
  action: string,
): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (!tab?.url || normalizeOrigin(tab.url) !== normalizeOrigin(origin)) {
    throw new Error(`Refusing to ${action}: tab ${tabId} is no longer showing origin "${origin}"`);
  }
}
