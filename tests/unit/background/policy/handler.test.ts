import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleDeletePolicy,
  handleGetPolicies,
  handleSetHighTrustOrigin,
  handleSetPolicy,
} from '../../../../background/policy/handler';
import { createRootIdentity } from '../../../../background/vault/setup';
import type { UnlockInput } from '../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('policy handlers', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('handleGetPolicies/handleSetPolicy/handleDeletePolicy round-trip through the message handlers', async () => {
    expect(await handleGetPolicies({ type: 'GET_POLICIES' })).toEqual([]);

    const rule = {
      scope: { kind: 'global' as const },
      fieldType: 'phone' as const,
      action: 'deny' as const,
    };
    const afterSet = await handleSetPolicy({ type: 'SET_POLICY', payload: rule });
    expect(afterSet).toEqual([rule]);
    expect(await handleGetPolicies({ type: 'GET_POLICIES' })).toEqual([rule]);

    const afterDelete = await handleDeletePolicy({
      type: 'DELETE_POLICY',
      payload: { scope: { kind: 'global' }, fieldType: 'phone' },
    });
    expect(afterDelete).toEqual([]);
  });

  it('handleSetHighTrustOrigin round-trips through the message handler', async () => {
    const result = await handleSetHighTrustOrigin({
      type: 'SET_HIGH_TRUST_ORIGIN',
      payload: { origin: 'https://gov.example', isHighTrust: true },
    });
    expect(result).toEqual(['https://gov.example']);
  });
});
