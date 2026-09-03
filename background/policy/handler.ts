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
import {
  PERSONAL_DATA_FIELD_DEFAULT_ACTION,
  type PersonalDataFieldName,
  type ResponseType,
} from '../../shared/vault-schema';
import { availableResponses } from '../firewall/responseAvailability';
import { assertTabShowsOrigin } from '../tabOriginGuard';
import { getPersonalData } from '../vault/personalData/storage';
import { readVaultIndex } from '../vault/storage';
import { deletePolicy, setHighTrustOrigin, setPolicy } from './storage';

// PERSONAL_DATA_FIELD_DEFAULT_ACTION is a Record keyed by every
// PersonalDataFieldName -- reusing its keys instead of a fourth hardcoded
// list of the same six field names, so this stays exhaustive automatically
// if a field is ever added there.
const PERSONAL_DATA_FIELD_NAMES = Object.keys(
  PERSONAL_DATA_FIELD_DEFAULT_ACTION,
) as PersonalDataFieldName[];

// Reads the vault index directly (not via storage.ts's own getPolicies(),
// which would independently call readVaultIndex() a second time) and
// derives `policies` from it, matching firewall/handler.ts's own
// loadPolicyContext() convention -- one decrypt per request, not two.
export async function handleGetPolicies(
  _message: GetPoliciesMessage,
): Promise<GetPoliciesResponse> {
  const [personalData, index] = await Promise.all([getPersonalData(), readVaultIndex()]);
  const aliasProviderConfigured = index.aliasProviderConfig.provider !== 'none';

  const perField = PERSONAL_DATA_FIELD_NAMES.map((fieldType) => [
    fieldType,
    availableResponses(fieldType, personalData[fieldType] !== undefined, aliasProviderConfigured),
  ]);

  return {
    policies: index.policies,
    availableResponses: Object.fromEntries(perField) as Record<
      PersonalDataFieldName,
      ResponseType[]
    >,
  };
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
