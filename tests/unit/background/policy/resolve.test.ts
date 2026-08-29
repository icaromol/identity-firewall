import { describe, expect, it } from 'vitest';
import { resolvePolicy } from '../../../../background/policy/resolve';
import type { PolicyRule } from '../../../../shared/vault-schema';

describe('resolvePolicy', () => {
  it('falls back to the baseline default when no rule exists', () => {
    expect(resolvePolicy('https://example.com', 'phone', [], false, false)).toBe('deny');
    expect(resolvePolicy('https://example.com', 'name', [], false, false)).toBe('ask');
  });

  it("returns 'alias' for email once a provider is configured, even with no rule", () => {
    expect(resolvePolicy('https://example.com', 'email', [], false, true)).toBe('alias');
    expect(resolvePolicy('https://example.com', 'email', [], false, false)).toBe('ask');
  });

  it('a global rule overrides the baseline', () => {
    const policies: PolicyRule[] = [
      { scope: { kind: 'global' }, fieldType: 'phone', action: 'real' },
    ];
    expect(resolvePolicy('https://example.com', 'phone', policies, false, false)).toBe('real');
  });

  it('an origin-scoped rule overrides both the global rule and the baseline', () => {
    const policies: PolicyRule[] = [
      { scope: { kind: 'global' }, fieldType: 'phone', action: 'real' },
      {
        scope: { kind: 'origin', origin: 'https://shop.example' },
        fieldType: 'phone',
        action: 'deny',
      },
    ];
    expect(resolvePolicy('https://shop.example', 'phone', policies, false, false)).toBe('deny');
    // A different origin isn't affected by shop.example's own rule.
    expect(resolvePolicy('https://other.example', 'phone', policies, false, false)).toBe('real');
  });

  it('matches an origin rule regardless of non-canonical port/case differences', () => {
    const policies: PolicyRule[] = [
      {
        scope: { kind: 'origin', origin: 'https://Shop.example:443' },
        fieldType: 'address',
        action: 'real',
      },
    ];
    expect(resolvePolicy('https://shop.example', 'address', policies, false, false)).toBe('real');
  });

  it('high-trust safe mode always returns "ask", beating any stored rule', () => {
    const policies: PolicyRule[] = [
      {
        scope: { kind: 'origin', origin: 'https://gov.example' },
        fieldType: 'nationalId',
        action: 'real',
      },
    ];
    expect(resolvePolicy('https://gov.example', 'nationalId', policies, true, false)).toBe('ask');
  });

  it('clamps a highly-sensitive field to "ask" even when a stored rule says otherwise', () => {
    // nationalId can never auto-resolve to a real or fabricated value via
    // policy -- Phase 5's biometric gate (the other half of data-model.md's
    // "Ask + biometric" default) doesn't exist yet, so a stored 'real'
    // rule would otherwise silently disclose the user's CPF with zero
    // friction on every visit.
    const policies: PolicyRule[] = [
      { scope: { kind: 'global' }, fieldType: 'nationalId', action: 'real' },
    ];
    expect(resolvePolicy('https://example.com', 'nationalId', policies, false, false)).toBe('ask');
  });

  it('still honors a stored "deny" rule for a highly-sensitive field', () => {
    const policies: PolicyRule[] = [
      { scope: { kind: 'global' }, fieldType: 'nationalId', action: 'deny' },
    ];
    expect(resolvePolicy('https://example.com', 'nationalId', policies, false, false)).toBe('deny');
  });

  it('an apparently-optional field with no matching rule defaults to "deny", not the fieldType baseline', () => {
    // name's baseline (PERSONAL_DATA_FIELD_DEFAULT_ACTION) is 'ask' -- but
    // "optional fields are blocked by default" (data-model.md) takes
    // priority when nothing more specific has been set for this field.
    expect(resolvePolicy('https://example.com', 'name', [], false, false, false)).toBe('deny');
  });

  it('defaults apparentlyRequired to true when the caller omits it, preserving the fieldType baseline', () => {
    expect(resolvePolicy('https://example.com', 'name', [], false, false)).toBe('ask');
  });

  it('an explicit stored rule still applies to an apparently-optional field, overriding the optional-blocks default', () => {
    const policies: PolicyRule[] = [
      { scope: { kind: 'global' }, fieldType: 'name', action: 'real' },
    ];
    expect(resolvePolicy('https://example.com', 'name', policies, false, false, false)).toBe(
      'real',
    );
  });
});
