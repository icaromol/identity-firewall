// Reads/writes the Policies and highTrustOrigins trees, both already
// living in the vault index tier since Phase 2 -- no new storage tier
// needed, same as background/vault/personalData/storage.ts's own
// relationship to vault/storage.ts.

import { normalizeOrigin } from '../../shared/origin';
import type { PersonalDataFieldName, PolicyRule, PolicyScope } from '../../shared/vault-schema';
import { readVaultIndex, updateVaultIndexWithResult } from '../vault/storage';

// Two scopes are "the same rule slot" when they're both global, or both
// origin-scoped for the same normalized origin -- used to decide whether
// setPolicy replaces an existing rule or appends a new one.
function scopesMatch(a: PolicyScope, b: PolicyScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'origin' && b.kind === 'origin') {
    return normalizeOrigin(a.origin) === normalizeOrigin(b.origin);
  }
  return true;
}

export async function getPolicies(): Promise<PolicyRule[]> {
  return (await readVaultIndex()).policies;
}

// Upsert by (scope, fieldType) -- at most one rule per slot, matching
// background/policy/resolve.ts's own "first match wins" assumption (if
// two rules could occupy the same slot, resolution order would depend on
// array position, an accident waiting to happen).
export function setPolicy(rule: PolicyRule): Promise<PolicyRule[]> {
  return updateVaultIndexWithResult((draft) => {
    const withoutExisting = draft.policies.filter(
      (p) => !(scopesMatch(p.scope, rule.scope) && p.fieldType === rule.fieldType),
    );
    const policies = [...withoutExisting, rule];
    return { next: { ...draft, policies }, result: policies };
  });
}

export function deletePolicy(
  scope: PolicyScope,
  fieldType: PersonalDataFieldName,
): Promise<PolicyRule[]> {
  return updateVaultIndexWithResult((draft) => {
    const policies = draft.policies.filter(
      (p) => !(scopesMatch(p.scope, scope) && p.fieldType === fieldType),
    );
    return { next: { ...draft, policies }, result: policies };
  });
}

export async function getHighTrustOrigins(): Promise<string[]> {
  return (await readVaultIndex()).highTrustOrigins;
}

export async function isHighTrustOrigin(origin: string): Promise<boolean> {
  const normalized = normalizeOrigin(origin);
  const origins = await getHighTrustOrigins();
  return origins.some((o) => normalizeOrigin(o) === normalized);
}

export function setHighTrustOrigin(origin: string, isHighTrust: boolean): Promise<string[]> {
  const normalized = normalizeOrigin(origin);
  return updateVaultIndexWithResult((draft) => {
    const withoutOrigin = draft.highTrustOrigins.filter((o) => normalizeOrigin(o) !== normalized);
    const highTrustOrigins = isHighTrust ? [...withoutOrigin, normalized] : withoutOrigin;
    return { next: { ...draft, highTrustOrigins }, result: highTrustOrigins };
  });
}
