import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getPersonalData,
  setPersonalData,
} from '../../../../../background/vault/personalData/storage';
import { createRootIdentity } from '../../../../../background/vault/setup';
import { VaultLockedError } from '../../../../../background/vault/storage';
import { lockVault } from '../../../../../background/vault/unlock';
import type { UnlockInput } from '../../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('personalData storage', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('getPersonalData returns an empty object on a fresh vault', async () => {
    expect(await getPersonalData()).toEqual({});
  });

  it('setPersonalData round-trips a single field', async () => {
    const result = await setPersonalData({ name: 'Alice' });
    expect(result).toEqual({ name: 'Alice' });
    expect(await getPersonalData()).toEqual({ name: 'Alice' });
  });

  it('a second patch preserves fields not included in it', async () => {
    await setPersonalData({ name: 'Alice' });
    const result = await setPersonalData({ email: 'alice@example.com' });

    expect(result).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(await getPersonalData()).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('a patch overwrites an already-set field with a new value', async () => {
    await setPersonalData({ name: 'Alice' });
    const result = await setPersonalData({ name: 'Alicia' });

    expect(result).toEqual({ name: 'Alicia' });
  });

  it('an explicit undefined-valued key in the patch does not clear an existing field', async () => {
    await setPersonalData({ name: 'Alice', email: 'alice@example.com' });
    const result = await setPersonalData({ name: 'Alicia', email: undefined });

    expect(result).toEqual({ name: 'Alicia', email: 'alice@example.com' });
  });

  it('getPersonalData rejects with VaultLockedError when locked', async () => {
    await lockVault();
    await expect(getPersonalData()).rejects.toThrow(VaultLockedError);
  });

  it('setPersonalData rejects with VaultLockedError when locked', async () => {
    await lockVault();
    await expect(setPersonalData({ name: 'Alice' })).rejects.toThrow(VaultLockedError);
  });
});
