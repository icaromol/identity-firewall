import type {
  DeletePolicyMessage,
  DeletePolicyResponse,
  GetAllPrivacyLedgerMessage,
  GetAllPrivacyLedgerResponse,
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
import { assertTabShowsOrigin } from '../tabOriginGuard';
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

// Re-verifies the tab is still on `origin` before acting (see
// tabOriginGuard.ts's own header comment) -- a /code-review finding:
// without it, a stale cached origin (the tab navigated away while the
// popup stayed open) could mark or unmark safe-mode for the wrong site.
export async function handleSetHighTrustOrigin(
  message: SetHighTrustOriginMessage,
): Promise<SetHighTrustOriginResponse> {
  const { origin, tabId, isHighTrust } = message.payload;

  await assertTabShowsOrigin(tabId, origin, 'change high-trust status');

  return setHighTrustOrigin(origin, isHighTrust);
}

export async function handleGetPrivacyLedger(
  message: GetPrivacyLedgerMessage,
): Promise<GetPrivacyLedgerResponse> {
  const normalized = normalizeOrigin(message.payload.origin);
  const { privacyLedger } = await readVaultIndex();
  return privacyLedger.filter((entry) => normalizeOrigin(entry.origin) === normalized);
}

// Phase 6 -- the Options page's all-sites "Who knows what about me" tab.
// privacyLedger is already a single flat array spanning every origin
// (recordDisclosure appends to it, unfiltered); handleGetPrivacyLedger just
// narrows that same array down to one origin, so returning it as-is here is
// the whole implementation -- no new storage tier, just a different read.
export async function handleGetAllPrivacyLedger(
  _message: GetAllPrivacyLedgerMessage,
): Promise<GetAllPrivacyLedgerResponse> {
  const { privacyLedger } = await readVaultIndex();
  return privacyLedger;
}
