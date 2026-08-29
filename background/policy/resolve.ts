// Phase 4's Policy Engine resolution logic -- decides, per (origin,
// fieldType), whether the Firewall can act automatically or needs to
// interrupt the user. See docs/plans/phase-4-privacy-ledger-policy-engine.md's
// "Key design decisions" for why this returns a PolicyAction (ResponseType
// | 'ask'), not a bare ResponseType, and why resolution order is
// safe-mode -> origin rule -> global rule -> baseline.

import { normalizeOrigin } from '../../shared/origin';
import type { PersonalDataFieldName, PolicyAction, PolicyRule } from '../../shared/vault-schema';
import {
  PERSONAL_DATA_FIELD_DEFAULT_ACTION,
  PERSONAL_DATA_FIELD_SENSITIVITY,
} from '../../shared/vault-schema';

export function resolvePolicy(
  origin: string,
  fieldType: PersonalDataFieldName,
  policies: PolicyRule[],
  isHighTrustOrigin: boolean,
  aliasProviderConfigured: boolean,
  // Whether THIS specific field instance appeared apparently-required on
  // its form -- distinct from fieldType's own sensitivity. Only affects
  // the no-matching-rule fallback (below): an explicit stored PolicyRule
  // (global or origin) always wins regardless, since setting one is
  // itself the user's conscious choice to auto-decide even an optional
  // field. Defaults to true (the safer assumption when a caller doesn't
  // have this information) so omitting it never accidentally UNBLOCKS an
  // optional field.
  apparentlyRequired = true,
): PolicyAction {
  // Government/financial safe mode always wins -- overrides even an
  // explicit stored 'real'/'alias'/etc. rule for that origin, never the
  // other way round (design decision 6).
  if (isHighTrustOrigin) return 'ask';

  const normalized = normalizeOrigin(origin);

  const originRule = policies.find(
    (p) =>
      p.scope.kind === 'origin' &&
      normalizeOrigin(p.scope.origin) === normalized &&
      p.fieldType === fieldType,
  );
  const globalRule = policies.find((p) => p.scope.kind === 'global' && p.fieldType === fieldType);

  let action: PolicyAction;
  if (originRule) {
    action = originRule.action;
  } else if (globalRule) {
    action = globalRule.action;
  } else if (!apparentlyRequired) {
    // No explicit rule exists for this field, and it's apparently
    // optional -- data-model.md/privacy-model.md's own rule ("optional
    // fields are blocked by default") takes priority over
    // PERSONAL_DATA_FIELD_DEFAULT_ACTION's blanket per-fieldType baseline,
    // which knows nothing about this specific field instance's
    // required/optional status.
    action = 'deny';
  } else {
    const baseline = PERSONAL_DATA_FIELD_DEFAULT_ACTION[fieldType];
    // email's baseline is 'ask' specifically because no provider is
    // configured by default (data-model.md: "Alias, if a provider is
    // configured; otherwise Ask") -- once one is, the baseline itself
    // becomes 'alias', mirroring responseAvailability.ts's own gating.
    action =
      fieldType === 'email' && baseline === 'ask' && aliasProviderConfigured ? 'alias' : baseline;
  }

  // A highly-sensitive field (nationalId) can NEVER auto-resolve to a
  // real or fabricated value via a stored policy, no matter what that
  // rule says -- clamped to 'ask' here, not left to responseAvailability.ts
  // downstream to catch. A PolicyRule could otherwise let this project's
  // most consequential field be silently disclosed on every visit with
  // zero friction, since Phase 5's biometric gate (the OTHER half of
  // data-model.md's "Ask + biometric" default) doesn't exist yet -- a
  // stored 'deny' rule is still honored, since denying is never unsafe.
  if (PERSONAL_DATA_FIELD_SENSITIVITY[fieldType] === 'highlySensitive' && action !== 'deny') {
    return 'ask';
  }

  return action;
}
