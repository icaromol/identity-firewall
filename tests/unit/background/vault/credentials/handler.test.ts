import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleDeleteCredential,
  handleGetCredential,
  handleSaveCredential,
} from '../../../../../background/vault/credentials/handler';
import { createRootIdentity } from '../../../../../background/vault/setup';
import type {
  DeleteCredentialMessage,
  GetCredentialMessage,
  SaveCredentialMessage,
  UnlockInput,
} from '../../../../../shared/messages';
import type { CredentialRecord } from '../../../../../shared/vault-schema';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

const passwordCredential: CredentialRecord = {
  kind: 'password',
  username: 'alice',
  password: 'hunter2',
};

describe('credentials handlers', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('handleGetCredential returns [] before saving, the credential after', async () => {
    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([]);

    const saveMessage: SaveCredentialMessage = {
      type: 'SAVE_CREDENTIAL',
      payload: { origin: 'https://example.com', credential: passwordCredential },
    };
    await handleSaveCredential(saveMessage);

    expect(await handleGetCredential(getMessage)).toEqual([passwordCredential]);
  });

  it('handleDeleteCredential removes a saved credential through the handler', async () => {
    const saveMessage: SaveCredentialMessage = {
      type: 'SAVE_CREDENTIAL',
      payload: { origin: 'https://example.com', credential: passwordCredential },
    };
    await handleSaveCredential(saveMessage);

    const deleteMessage: DeleteCredentialMessage = {
      type: 'DELETE_CREDENTIAL',
      payload: { origin: 'https://example.com', kind: 'password' },
    };
    await handleDeleteCredential(deleteMessage);

    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([]);
  });

  it('normalizes the origin at the handler boundary', async () => {
    const saveMessage: SaveCredentialMessage = {
      type: 'SAVE_CREDENTIAL',
      payload: { origin: 'https://Example.com:443/some/path', credential: passwordCredential },
    };
    await handleSaveCredential(saveMessage);

    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'HTTPS://EXAMPLE.COM' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([passwordCredential]);
  });
});
