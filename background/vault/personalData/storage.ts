// Reads/writes the top-level PersonalData tier (ADR-015's Tier 2, its own
// storage key, if_vault_personal_data_v1) via vault/storage.ts's
// readPersonalDataBlob/updatePersonalDataBlobWithResult -- one write path,
// same convention as every other capability module.

import { stripUndefinedValues } from '../../../shared/patch';
import type { PersonalData } from '../../../shared/vault-schema';
import { readPersonalDataBlob, updatePersonalDataBlobWithResult } from '../storage';

export async function getPersonalData(): Promise<PersonalData> {
  return readPersonalDataBlob();
}

// Patch-style: every field already .optional(), so a key simply absent from
// `patch` leaves the stored value untouched (setPersonalData twice preserves
// fields not included in the second call -- the M6 acceptance criterion).
// See stripUndefinedValues's own comment for why an explicit `undefined`-
// valued key is stripped before merging rather than left to clobber a
// previously-saved value.
//
// Clearing a field to empty means sending '' -- PersonalDataSchema fields are
// .optional(), not .nullable(), so there's no schema-legal "delete this key"
// sentinel.
export async function setPersonalData(patch: PersonalData): Promise<PersonalData> {
  const cleanPatch = stripUndefinedValues(patch) as PersonalData;

  return updatePersonalDataBlobWithResult((draft) => {
    const merged = { ...draft, ...cleanPatch };
    return { next: merged, result: merged };
  });
}
