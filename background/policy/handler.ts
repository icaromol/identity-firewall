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

export async function handleSetHighTrustOrigin(
  message: SetHighTrustOriginMessage,
): Promise<SetHighTrustOriginResponse> {
  return setHighTrustOrigin(message.payload.origin, message.payload.isHighTrust);
}

export async function handleGetPrivacyLedger(
  message: GetPrivacyLedgerMessage,
): Promise<GetPrivacyLedgerResponse> {
  const normalized = normalizeOrigin(message.payload.origin);
  const { privacyLedger } = await readVaultIndex();
  return privacyLedger.filter((entry) => normalizeOrigin(entry.origin) === normalized);
}
