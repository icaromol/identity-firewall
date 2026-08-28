import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createServiceIdentity, getServiceIdentity } from '../../../../background/identity/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import { VaultLockedError } from '../../../../background/vault/storage';
import { lockVault } from '../../../../background/vault/unlock';
import type { UnlockInput } from '../../../../shared/messages';
import { normalizeOrigin } from '../../../../shared/origin';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

const originA = normalizeOrigin('https://a.example');
const originB = normalizeOrigin('https://b.example');

describe('identity storage', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('getServiceIdentity returns null before creation', async () => {
    expect(await getServiceIdentity(originA)).toBeNull();
  });

  it('createServiceIdentity creates a record with empty credentials/aliases/history', async () => {
    const record = await createServiceIdentity(originA);

    expect(record.origin).toBe(originA);
    expect(record.identifierB64).toEqual(expect.any(String));
    expect(record.credentials).toEqual([]);
    expect(record.aliases).toEqual([]);
    expect(record.history).toEqual([]);
  });

  it('getServiceIdentity returns the same values after creation', async () => {
    const created = await createServiceIdentity(originA);
    expect(await getServiceIdentity(originA)).toEqual(created);
  });

  it('createServiceIdentity is idempotent -- a second call returns the same record', async () => {
    const first = await createServiceIdentity(originA);
    const second = await createServiceIdentity(originA);
    expect(second).toEqual(first);
  });

  it('two different origins get different service identities', async () => {
    const forA = await createServiceIdentity(originA);
    const forB = await createServiceIdentity(originB);

    expect(forB.identifierB64).not.toBe(forA.identifierB64);
    expect(forB.origin).not.toBe(forA.origin);
  });

  it('createServiceIdentity rejects with VaultLockedError when the vault is locked', async () => {
    await lockVault();
    await expect(createServiceIdentity(originA)).rejects.toThrow(VaultLockedError);
  });

  it('getServiceIdentity rejects with VaultLockedError when the vault is locked', async () => {
    await lockVault();
    await expect(getServiceIdentity(originA)).rejects.toThrow(VaultLockedError);
  });
});
