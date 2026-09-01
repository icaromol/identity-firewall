import { describe, expect, it } from 'vitest';
import { generateResponseValue } from '../../../../background/firewall/responseGenerator';
import { normalizeOrigin } from '../../../../shared/origin';
import type { PersonalData } from '../../../../shared/vault-schema';

const personalData: PersonalData = {
  name: 'Ícaro',
  email: 'icaro@example.com',
};
const origin = normalizeOrigin('https://example.com');
const rootSecret = new Uint8Array(32).fill(7);

describe('generateResponseValue', () => {
  it('returns the real value for a field PersonalData has', async () => {
    expect(await generateResponseValue('name', 'real', personalData, origin, rootSecret)).toBe(
      'Ícaro',
    );
  });

  it('returns null for real when PersonalData has no value for that field', async () => {
    expect(
      await generateResponseValue('phone', 'real', personalData, origin, rootSecret),
    ).toBeNull();
  });

  it('returns a generated value for synthetic', async () => {
    expect(await generateResponseValue('name', 'synthetic', personalData, origin, rootSecret)).toBe(
      'João Silva',
    );
  });

  it('returns a generated value for nonsense', async () => {
    expect(await generateResponseValue('name', 'nonsense', personalData, origin, rootSecret)).toBe(
      'Xablau 9000',
    );
  });

  it('returns null for deny', async () => {
    expect(
      await generateResponseValue('name', 'deny', personalData, origin, rootSecret),
    ).toBeNull();
  });

  it('throws for alias -- not implemented until Phase 9', async () => {
    await expect(
      generateResponseValue('email', 'alias', personalData, origin, rootSecret),
    ).rejects.toThrow();
  });
});
