// Implements docs/plans/phase-3-identity-firewall.md's "Key design
// decisions" #5 response-availability matrix, derived directly from
// data-model.md's sensitivity table and its explicit warning against
// fabricating highly-sensitive data (a fake CPF can break the user's own
// account or violate a legal requirement, not just "look bad").

import type { PersonalData, ResponseType } from '../../shared/vault-schema';
import { PERSONAL_DATA_FIELD_SENSITIVITY } from '../../shared/vault-schema';

export function availableResponses(
  fieldType: keyof PersonalData,
  hasRealValue: boolean,
  aliasProviderConfigured: boolean,
): ResponseType[] {
  const sensitivity = PERSONAL_DATA_FIELD_SENSITIVITY[fieldType];

  // highlySensitive (nationalId) gets Real/Deny only -- no Synthetic/
  // Nonsense, ever. Every other field gets the full fabrication set.
  let responses: ResponseType[] =
    sensitivity === 'highlySensitive'
      ? ['real', 'deny']
      : ['real', 'synthetic', 'nonsense', 'deny'];

  // Alias is confirmed-with-the-user disabled without a configured
  // provider (Phase 6's job) rather than generating a non-functional
  // local placeholder -- see the plan doc's resolved design question.
  // Scoped to email only: no other field type has a meaningful "alias"
  // concept without real infrastructure behind it.
  if (fieldType === 'email' && aliasProviderConfigured) {
    responses = [...responses, 'alias'];
  }

  // 'Real' is only offered when there's something real to disclose.
  return hasRealValue ? responses : responses.filter((r) => r !== 'real');
}
