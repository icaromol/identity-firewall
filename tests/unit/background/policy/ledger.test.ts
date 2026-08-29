import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { recordDisclosure } from '../../../../background/policy/ledger';
import { createRootIdentity } from '../../../../background/vault/setup';
import { readVaultIndex } from '../../../../background/vault/storage';
import type { UnlockInput } from '../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('recordDisclosure', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('appends an entry with a null authorizationMethod and a normalized origin', async () => {
    await recordDisclosure('https://Example.com:443', ['email', 'phone'], { email: 'alias' }, [
      'phone',
    ]);

    const { privacyLedger } = await readVaultIndex();
    expect(privacyLedger).toHaveLength(1);
    expect(privacyLedger[0]).toMatchObject({
      origin: 'https://example.com',
      requestedFields: ['email', 'phone'],
      disclosedFields: { email: 'alias' },
      deniedFields: ['phone'],
      authorizationMethod: null,
    });
    expect(typeof privacyLedger[0]?.at).toBe('number');
  });

  it('accumulates multiple entries rather than overwriting', async () => {
    await recordDisclosure('https://a.example', ['name'], { name: 'real' }, []);
    await recordDisclosure('https://b.example', ['phone'], {}, ['phone']);

    const { privacyLedger } = await readVaultIndex();
    expect(privacyLedger).toHaveLength(2);
    expect(privacyLedger.map((e) => e.origin)).toEqual(['https://a.example', 'https://b.example']);
  });
});
