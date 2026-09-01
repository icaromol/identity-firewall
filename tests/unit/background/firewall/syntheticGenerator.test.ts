import { describe, expect, it } from 'vitest';
import {
  generateNonsenseValue,
  generateSyntheticValue,
} from '../../../../background/firewall/syntheticGenerator';
import { normalizeOrigin } from '../../../../shared/origin';

const rootSecret = new Uint8Array(32).fill(7);
const originA = normalizeOrigin('https://a.example');
const originB = normalizeOrigin('https://b.example');

describe('generateSyntheticValue', () => {
  it('generates a synthetic email ending in the RFC 2606 reserved .invalid TLD', async () => {
    expect(await generateSyntheticValue('email', originA, rootSecret)).toMatch(
      /@example\.invalid$/,
    );
  });

  it('generates a non-empty, non-real-looking value for every other field type', async () => {
    for (const fieldType of ['name', 'phone', 'address', 'birthDate'] as const) {
      const value = await generateSyntheticValue(fieldType, originA, rootSecret);
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('throws for nationalId -- Synthetic must never be offered for a highly sensitive field', async () => {
    await expect(generateSyntheticValue('nationalId', originA, rootSecret)).rejects.toThrow();
  });

  // ADR-016 (Phase 5 M6) -- the actual bug this milestone fixes: the same
  // site, asked twice, must get the SAME fabricated email both times, or
  // the "useful for detecting who leaked your data" claim in
  // product-vision.md is simply false.
  it('produces the SAME email token every time for the same (origin, rootSecret)', async () => {
    const a = await generateSyntheticValue('email', originA, rootSecret);
    const b = await generateSyntheticValue('email', originA, rootSecret);
    expect(a).toBe(b);
  });

  it('produces a DIFFERENT email token for a different origin (the same root secret)', async () => {
    const a = await generateSyntheticValue('email', originA, rootSecret);
    const b = await generateSyntheticValue('email', originB, rootSecret);
    expect(a).not.toBe(b);
  });

  it('produces a DIFFERENT email token for a different root secret (the same origin)', async () => {
    const otherRootSecret = new Uint8Array(32).fill(9);
    const a = await generateSyntheticValue('email', originA, rootSecret);
    const b = await generateSyntheticValue('email', originA, otherRootSecret);
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

  // ADR-016 decision 5 -- Nonsense is deliberately UNCHANGED, never
  // deterministic. No leak-detection claim was ever made for it.
  it('remains non-deterministic across calls, unlike Synthetic', () => {
    const a = generateNonsenseValue('email');
    const b = generateNonsenseValue('email');
    expect(a).not.toBe(b);
  });
});
