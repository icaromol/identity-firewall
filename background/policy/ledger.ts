// Appends one PrivacyLedgerEntry to the vault index -- called from both
// the automatic path (background/formDetection/handler.ts, via
// autoApply.ts's computed result) and the manual path
// (background/firewall/handler.ts's handleSubmitFieldDecisions), so
// nothing this project can disclose -- automatically or by explicit user
// choice -- goes unrecorded. authorizationMethod is always null until
// Phase 5 wires biometric authorization.

import { normalizeOrigin } from '../../shared/origin';
import type { PersonalDataFieldName, ResponseType } from '../../shared/vault-schema';
import { updateVaultIndex } from '../vault/storage';

export async function recordDisclosure(
  origin: string,
  requestedFields: PersonalDataFieldName[],
  disclosedFields: Partial<Record<PersonalDataFieldName, ResponseType>>,
  deniedFields: PersonalDataFieldName[],
): Promise<void> {
  await updateVaultIndex((draft) => ({
    ...draft,
    privacyLedger: [
      ...draft.privacyLedger,
      {
        origin: normalizeOrigin(origin),
        at: Date.now(),
        requestedFields,
        disclosedFields,
        deniedFields,
        authorizationMethod: null,
      },
    ],
  }));
}
