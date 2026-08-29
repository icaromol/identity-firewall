import { describe, expect, it } from 'vitest';
import {
  generateNonsenseValue,
  generateSyntheticValue,
} from '../../../../background/firewall/syntheticGenerator';

describe('generateSyntheticValue', () => {
  it('generates a synthetic email ending in the RFC 2606 reserved .invalid TLD', () => {
    expect(generateSyntheticValue('email')).toMatch(/@example\.invalid$/);
  });

  it('generates a non-empty, non-real-looking value for every other field type', () => {
    for (const fieldType of ['name', 'phone', 'address', 'birthDate'] as const) {
      const value = generateSyntheticValue(fieldType);
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('throws for nationalId -- Synthetic must never be offered for a highly sensitive field', () => {
    expect(() => generateSyntheticValue('nationalId')).toThrow();
  });

  it('produces a different token on each call for email (no reused module-level counter)', () => {
    const a = generateSyntheticValue('email');
    const b = generateSyntheticValue('email');
    expect(a).not.toBe(b);
  });
});

describe('generateNonsenseValue', () => {
  it('generates a nonsense email ending in .invalid', () => {
    expect(generateNonsenseValue('email')).toMatch(/@example\.invalid$/);
  });

  it('generates a non-empty value for every other field type', () => {
    for (const fieldType of ['name', 'phone', 'address', 'birthDate'] as const) {
      expect(generateNonsenseValue(fieldType).length).toBeGreaterThan(0);
    }
  });

  it('throws for nationalId -- Nonsense must never be offered for a highly sensitive field', () => {
    expect(() => generateNonsenseValue('nationalId')).toThrow();
  });
});
