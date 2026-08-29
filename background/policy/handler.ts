import { browser } from 'wxt/browser';
import type {
  DeletePolicyMessage,
  DeletePolicyResponse,
  GetPoliciesMessage,
  GetPoliciesResponse,
  GetPrivacyLedgerMessage,
  GetPrivacyLedgerResponse,
  SetHighTrustOriginMessage,
  SetHighTrustOriginResponse,
  SetPolicyMessage,
  SetPolicyResponse,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { readVaultIndex } from '../vault/storage';
import { deletePolicy, getPolicies, setHighTrustOrigin, setPolicy } from './storage';

export async function handleGetPolicies(
  _message: GetPoliciesMessage,
): Promise<GetPoliciesResponse> {
  return getPolicies();
}

export async function handleSetPolicy(message: SetPolicyMessage): Promise<SetPolicyResponse> {
  return setPolicy(message.payload);
}

export async function handleDeletePolicy(
  message: DeletePolicyMessage,
): Promise<DeletePolicyResponse> {
  return deletePolicy(message.payload.scope, message.payload.fieldType);
}

// Re-verifies the tab is still on `origin` before acting, mirroring
// background/firewall/handler.ts's handleSubmitFieldDecisions's own
// tab-recheck exactly -- a /code-review finding: without it, a stale
// cached origin (the tab navigated away while the popup stayed open)
// could mark or unmark safe-mode for the wrong site.
export async function handleSetHighTrustOrigin(
  message: SetHighTrustOriginMessage,
): Promise<SetHighTrustOriginResponse> {
  const { origin, tabId, isHighTrust } = message.payload;

  const tab = await browser.tabs.get(tabId);
  if (!tab?.url || normalizeOrigin(tab.url) !== normalizeOrigin(origin)) {
    throw new Error(
      `Refusing to change high-trust status: tab ${tabId} is no longer showing origin "${origin}"`,
    );
  }

  return setHighTrustOrigin(origin, isHighTrust);
}

export async function handleGetPrivacyLedger(
  message: GetPrivacyLedgerMessage,
): Promise<GetPrivacyLedgerResponse> {
  const normalized = normalizeOrigin(message.payload.origin);
  const { privacyLedger } = await readVaultIndex();
  return privacyLedger.filter((entry) => normalizeOrigin(entry.origin) === normalized);
}
