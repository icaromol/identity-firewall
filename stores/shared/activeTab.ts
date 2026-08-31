// Shared by every popup store scoped per-site (firewall, privacyLedger,
// pendingCredential, savedCredentials) -- each independently reimplemented
// browser.tabs.query({active,currentWindow}) + null-check +
// new URL(tab.url).origin before this was extracted. The backend already
// learned this exact lesson once for its own tab-origin check (see
// background/tabOriginGuard.ts's own header comment) before a fourth
// independent frontend copy of a *different* repeated pattern showed up
// (a /code-review finding, Phase 5 M5).

import { browser } from 'wxt/browser';

export interface ActiveTabResolution {
  tabId: number;
  origin: string;
}

export async function resolveActiveTab(): Promise<ActiveTabResolution> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.id === undefined) {
    throw new Error('Could not determine the active tab');
  }
  return { tabId: tab.id, origin: new URL(tab.url).origin };
}
