import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getServiceIdentity } from '../../../../../background/identity/storage';
import {
  deleteCredential,
  getCredentials,
  saveCredential,
} from '../../../../../background/vault/credentials/storage';
import { createRootIdentity } from '../../../../../background/vault/setup';
import { VaultLockedError } from '../../../../../background/vault/storage';
import { lockVault } from '../../../../../background/vault/unlock';
import type { UnlockInput } from '../../../../../shared/messages';
import { normalizeOrigin } from '../../../../../shared/origin';
import type { CredentialRecord } from '../../../../../shared/vault-schema';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

const origin = normalizeOrigin('https://a.example');

const passwordCredential: CredentialRecord = {
  kind: 'password',
  username: 'alice',
  password: 'hunter2',
};

const passkeyCredential: CredentialRecord = {
  kind: 'passkey',
  rpId: 'a.example',
  credentialId: 'abc123',
};

describe('credentials storage', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('getCredentials returns an empty array before any save', async () => {
    expect(await getCredentials(origin)).toEqual([]);
  });

  it('saveCredential round-trips a password credential', async () => {
    const saved = await saveCredential(origin, passwordCredential);
    expect(saved).toEqual(passwordCredential);
    expect(await getCredentials(origin)).toEqual([passwordCredential]);
  });

  it('saving a different kind for the same origin keeps both', async () => {
    await saveCredential(origin, passwordCredential);
    await saveCredential(origin, passkeyCredential);

    const credentials = await getCredentials(origin);
    expect(credentials).toHaveLength(2);
    expect(credentials).toEqual(expect.arrayContaining([passwordCredential, passkeyCredential]));
  });

  it('saving the same kind again replaces the previous one, not appends', async () => {
    await saveCredential(origin, passwordCredential);
    const replacement: CredentialRecord = {
      kind: 'password',
      username: 'bob',
      password: 'newpass',
    };
    await saveCredential(origin, replacement);

    const credentials = await getCredentials(origin);
    expect(credentials).toEqual([replacement]);
  });

  it('saveCredential auto-creates the ServiceIdentityRecord for a new origin', async () => {
    expect(await getServiceIdentity(origin)).toBeNull();

    await saveCredential(origin, passwordCredential);

    const record = await getServiceIdentity(origin);
    expect(record).not.toBeNull();
    expect(record?.identifierB64).toEqual(expect.any(String));
  });

  it('saveCredential derives the same identifierB64 across repeated calls for a new origin', async () => {
    await saveCredential(origin, passwordCredential);
    const firstIdentifier = (await getServiceIdentity(origin))?.identifierB64;

    await saveCredential(origin, passkeyCredential);
    const secondIdentifier = (await getServiceIdentity(origin))?.identifierB64;

    expect(secondIdentifier).toBe(firstIdentifier);
  });

  it('deleteCredential removes only the targeted kind', async () => {
    await saveCredential(origin, passwordCredential);
    await saveCredential(origin, passkeyCredential);

    await deleteCredential(origin, 'password');

    expect(await getCredentials(origin)).toEqual([passkeyCredential]);
  });

  it('deleteCredential on a nonexistent credential is a silent no-op', async () => {
    await expect(deleteCredential(origin, 'password')).resolves.toBeUndefined();
    expect(await getCredentials(origin)).toEqual([]);
  });

  it('deleteCredential on a nonexistent origin is a silent no-op', async () => {
    await expect(
      deleteCredential(normalizeOrigin('https://never-seen.example'), 'password'),
    ).resolves.toBeUndefined();
  });

  it('getCredentials rejects with VaultLockedError when locked', async () => {
    await lockVault();
    await expect(getCredentials(origin)).rejects.toThrow(VaultLockedError);
  });

  it('saveCredential rejects with VaultLockedError when locked', async () => {
    await lockVault();
    await expect(saveCredential(origin, passwordCredential)).rejects.toThrow(VaultLockedError);
  });

  it('deleteCredential rejects with VaultLockedError when locked and a credential exists', async () => {
    await saveCredential(origin, passwordCredential);
    await lockVault();
    await expect(deleteCredential(origin, 'password')).rejects.toThrow(VaultLockedError);
  });
});
