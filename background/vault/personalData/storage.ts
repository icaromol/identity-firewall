// Reads/writes the top-level PersonalData tier (ADR-015's Tier 2, its own
// storage key, if_vault_personal_data_v1) via vault/storage.ts's
// readPersonalDataBlob/updatePersonalDataBlobWithResult -- one write path,
// same convention as every other capability module.

import type { PersonalData } from '../../../shared/vault-schema';
import { readPersonalDataBlob, updatePersonalDataBlobWithResult } from '../storage';

export async function getPersonalData(): Promise<PersonalData> {
  return readPersonalDataBlob();
}

// Patch-style: every field already .optional(), so a key simply absent from
// `patch` leaves the stored value untouched (setPersonalData twice preserves
// fields not included in the second call -- the M6 acceptance criterion).
//
// An explicit `undefined`-valued key (e.g. { name: 'Alice', email: undefined }
// -- a common shape for a reactive form object where an untouched field is
// `undefined` rather than omitted entirely) is stripped before merging,
// treated the same as a fully-absent key -- a /code-review finding: Zod
// preserves undefined-valued keys as real own-enumerable properties through
// PersonalDataSchema.parse, so `{ ...draft, ...patch }` alone would
// silently overwrite a previously-saved field with undefined whenever a
// caller's patch object happened to carry one, rather than leaving it
// untouched as the "patch, not overwrite" contract requires.
//
// Clearing a field to empty means sending '' -- PersonalDataSchema fields are
// .optional(), not .nullable(), so there's no schema-legal "delete this key"
// sentinel.
export async function setPersonalData(patch: PersonalData): Promise<PersonalData> {
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as PersonalData;

  return updatePersonalDataBlobWithResult((draft) => {
    const merged = { ...draft, ...cleanPatch };
    return { next: merged, result: merged };
  });
}
