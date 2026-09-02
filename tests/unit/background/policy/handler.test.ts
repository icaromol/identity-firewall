import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleDeletePolicy,
  handleGetAllPrivacyLedger,
  handleGetPolicies,
  handleGetPrivacyLedger,
  handleSetHighTrustOrigin,
  handleSetPolicy,
} from '../../../../background/policy/handler';
import { recordDisclosure } from '../../../../background/policy/ledger';
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
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://gov.example/',
    } as never);

    const result = await handleSetHighTrustOrigin({
      type: 'SET_HIGH_TRUST_ORIGIN',
      payload: { origin: 'https://gov.example', tabId: 1, isHighTrust: true },
    });
    expect(result).toEqual(['https://gov.example']);
  });

  it('handleSetHighTrustOrigin refuses when the tab has navigated away from the claimed origin', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://attacker.example/',
    } as never);

    await expect(
      handleSetHighTrustOrigin({
        type: 'SET_HIGH_TRUST_ORIGIN',
        payload: { origin: 'https://gov.example', tabId: 1, isHighTrust: true },
      }),
    ).rejects.toThrow(/no longer showing origin/);
  });

  it('handleGetPrivacyLedger returns only entries for the requested (normalized) origin', async () => {
    await recordDisclosure('https://Example.com:443', ['email'], { email: 'real' }, []);
    await recordDisclosure('https://other.example', ['phone'], {}, ['phone']);

    const result = await handleGetPrivacyLedger({
      type: 'GET_PRIVACY_LEDGER',
      payload: { origin: 'https://example.com' },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ origin: 'https://example.com', requestedFields: ['email'] });
  });

  it('handleGetPrivacyLedger returns an empty array for an origin with no history', async () => {
    const result = await handleGetPrivacyLedger({
      type: 'GET_PRIVACY_LEDGER',
      payload: { origin: 'https://nothing-here.example' },
    });
    expect(result).toEqual([]);
  });

  it('handleGetAllPrivacyLedger returns entries across every origin, unfiltered', async () => {
    await recordDisclosure('https://example.com', ['email'], { email: 'real' }, []);
    await recordDisclosure('https://other.example', ['phone'], {}, ['phone']);

    const result = await handleGetAllPrivacyLedger({ type: 'GET_ALL_PRIVACY_LEDGER' });

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.origin)).toEqual([
      'https://example.com',
      'https://other.example',
    ]);
  });

  it('handleGetAllPrivacyLedger returns an empty array when nothing has been recorded', async () => {
    const result = await handleGetAllPrivacyLedger({ type: 'GET_ALL_PRIVACY_LEDGER' });
    expect(result).toEqual([]);
  });
});
