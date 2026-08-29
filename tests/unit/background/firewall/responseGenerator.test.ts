import { describe, expect, it } from 'vitest';
import { generateResponseValue } from '../../../../background/firewall/responseGenerator';
import type { PersonalData } from '../../../../shared/vault-schema';

const personalData: PersonalData = {
  name: 'Ícaro',
  email: 'icaro@example.com',
};

describe('generateResponseValue', () => {
  it('returns the real value for a field PersonalData has', () => {
    expect(generateResponseValue('name', 'real', personalData)).toBe('Ícaro');
  });

  it('returns null for real when PersonalData has no value for that field', () => {
    expect(generateResponseValue('phone', 'real', personalData)).toBeNull();
  });

  it('returns a generated value for synthetic', () => {
    expect(generateResponseValue('name', 'synthetic', personalData)).toBe('João Silva');
  });

  it('returns a generated value for nonsense', () => {
    expect(generateResponseValue('name', 'nonsense', personalData)).toBe('Xablau 9000');
  });

  it('returns null for deny', () => {
    expect(generateResponseValue('name', 'deny', personalData)).toBeNull();
  });

  it('throws for alias -- not implemented until Phase 6', () => {
    expect(() => generateResponseValue('email', 'alias', personalData)).toThrow();
  });
});
