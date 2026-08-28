import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createServiceIdentity, getServiceIdentity } from '../../../../background/identity/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import { deriveSitePayloadKey } from '../../../../background/vault/siteKey';
import {
  readSitePayload,
  readVaultIndex,
  VaultLockedError,
} from '../../../../background/vault/storage';
import { lockVault } from '../../../../background/vault/unlock';
import { base64ToBytes } from '../../../../shared/bytes';
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

  it('createServiceIdentity creates a meta entry with empty credentialKinds/history and a random payloadStorageKey', async () => {
    const meta = await createServiceIdentity(originA);

    expect(meta.origin).toBe(originA);
    expect(meta.identifierB64).toEqual(expect.any(String));
    expect(meta.credentialKinds).toEqual([]);
    expect(meta.aliasCount).toBe(0);
    expect(meta.history).toEqual([]);
    expect(meta.payloadStorageKey).toEqual(expect.any(String));
  });

  it('createServiceIdentity also initializes an empty Tier 3 site payload for the new origin', async () => {
    const meta = await createServiceIdentity(originA);

    const index = await readVaultIndex();
    const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);
    const siteKey = await deriveSitePayloadKey(rootSecret, originA);

    expect(await readSitePayload(meta.payloadStorageKey, siteKey)).toEqual({
      origin: originA,
      credentials: [],
      aliases: [],
    });
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
