import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  deletePolicy,
  getHighTrustOrigins,
  getPolicies,
  isHighTrustOrigin,
  setHighTrustOrigin,
  setPolicy,
} from '../../../../background/policy/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import type { UnlockInput } from '../../../../shared/messages';
import type { PolicyRule } from '../../../../shared/vault-schema';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('policy storage', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('getPolicies returns an empty array on a fresh vault', async () => {
    expect(await getPolicies()).toEqual([]);
  });

  it('setPolicy appends a new rule', async () => {
    const rule: PolicyRule = { scope: { kind: 'global' }, fieldType: 'phone', action: 'real' };
    const result = await setPolicy(rule);
    expect(result).toEqual([rule]);
    expect(await getPolicies()).toEqual([rule]);
  });

  it('setPolicy replaces an existing rule occupying the same (scope, fieldType) slot', async () => {
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'phone', action: 'real' });
    const updated = await setPolicy({
      scope: { kind: 'global' },
      fieldType: 'phone',
      action: 'deny',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.action).toBe('deny');
  });

  it('a global rule and an origin-scoped rule for the same fieldType coexist as separate slots', async () => {
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'phone', action: 'deny' });
    await setPolicy({
      scope: { kind: 'origin', origin: 'https://shop.example' },
      fieldType: 'phone',
      action: 'real',
    });

    expect(await getPolicies()).toHaveLength(2);
  });

  it('setPolicy normalizes an origin-scoped rule so a non-canonical origin still matches on upsert', async () => {
    await setPolicy({
      scope: { kind: 'origin', origin: 'https://Shop.example:443' },
      fieldType: 'address',
      action: 'real',
    });
    const updated = await setPolicy({
      scope: { kind: 'origin', origin: 'https://shop.example' },
      fieldType: 'address',
      action: 'deny',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.action).toBe('deny');
  });

  it('deletePolicy removes only the matching (scope, fieldType) slot', async () => {
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'phone', action: 'deny' });
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'address', action: 'real' });

    const remaining = await deletePolicy({ kind: 'global' }, 'phone');

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.fieldType).toBe('address');
  });

  it('getHighTrustOrigins/isHighTrustOrigin/setHighTrustOrigin round-trip and normalize', async () => {
    expect(await getHighTrustOrigins()).toEqual([]);
    expect(await isHighTrustOrigin('https://gov.example')).toBe(false);

    await setHighTrustOrigin('https://Gov.example:443', true);

    expect(await isHighTrustOrigin('https://gov.example')).toBe(true);
    expect(await getHighTrustOrigins()).toEqual(['https://gov.example']);
  });

  it('setHighTrustOrigin(origin, false) removes a previously-marked origin', async () => {
    await setHighTrustOrigin('https://gov.example', true);
    await setHighTrustOrigin('https://gov.example', false);

    expect(await isHighTrustOrigin('https://gov.example')).toBe(false);
    expect(await getHighTrustOrigins()).toEqual([]);
  });
});
