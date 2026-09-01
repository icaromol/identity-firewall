import type { CanonicalOrigin } from '../../shared/origin';
import type { PersonalData, ResponseType } from '../../shared/vault-schema';
import { generateNonsenseValue, generateSyntheticValue } from './syntheticGenerator';

// Resolves one field's chosen ResponseType into the concrete value to
// autofill, or null meaning "fill/send nothing." Only ever called with a
// ResponseType responseAvailability.ts actually offered for that field --
// callers are expected to gate on availableResponses() first, same
// invariant syntheticGenerator.ts's own nationalId branches rely on.
//
// async since ADR-016 (Phase 5 M6): the 'synthetic' branch derives its
// value deterministically per (origin, fieldType) via Web Crypto's HKDF,
// which has no synchronous form -- origin/rootSecret are only threaded
// through for that one branch's sake.
export async function generateResponseValue(
  fieldType: keyof PersonalData,
  responseType: ResponseType,
  personalData: PersonalData,
  origin: CanonicalOrigin,
  rootSecret: Uint8Array,
): Promise<string | null> {
  switch (responseType) {
    case 'real':
      return personalData[fieldType] ?? null;
    case 'synthetic':
      return generateSyntheticValue(fieldType, origin, rootSecret);
    case 'nonsense':
      return generateNonsenseValue(fieldType);
    case 'deny':
      return null;
    case 'alias':
      // Unreachable while responseAvailability.ts gates 'alias' behind
      // aliasProviderConfigured, which nothing sets true yet
      // (AliasProviderConfigSchema defaults to 'none') -- Phase 9's job.
      throw new Error('Alias response generation is not implemented until Phase 9');
  }
}
