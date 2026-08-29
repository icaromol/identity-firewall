import { describe, expect, it } from 'vitest';
import { availableResponses } from '../../../../background/firewall/responseAvailability';

describe('availableResponses', () => {
  it('offers only Real and Deny for nationalId (highly sensitive), never fabricated values', () => {
    expect(availableResponses('nationalId', true, false)).toEqual(['real', 'deny']);
  });

  it('offers Real/Synthetic/Nonsense/Deny for sensitive fields (name, phone, address, birthDate)', () => {
    for (const fieldType of ['name', 'phone', 'address', 'birthDate'] as const) {
      expect(availableResponses(fieldType, true, false)).toEqual([
        'real',
        'synthetic',
        'nonsense',
        'deny',
      ]);
    }
  });

  it('does not offer Alias for email without a configured provider', () => {
    expect(availableResponses('email', true, false)).toEqual([
      'real',
      'synthetic',
      'nonsense',
      'deny',
    ]);
  });

  it('offers Alias for email once a provider is configured', () => {
    expect(availableResponses('email', true, true)).toEqual([
      'real',
      'synthetic',
      'nonsense',
      'deny',
      'alias',
    ]);
  });

  it('never offers Alias for a non-email field, even with a provider configured', () => {
    expect(availableResponses('phone', true, true)).not.toContain('alias');
  });

  it('omits Real when there is no real value to disclose', () => {
    expect(availableResponses('name', false, false)).toEqual(['synthetic', 'nonsense', 'deny']);
    expect(availableResponses('nationalId', false, false)).toEqual(['deny']);
  });
});
