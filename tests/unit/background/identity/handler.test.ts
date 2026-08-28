import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleCreateServiceIdentity,
  handleGetServiceIdentity,
} from '../../../../background/identity/handler';
import { createRootIdentity } from '../../../../background/vault/setup';
import type {
  CreateServiceIdentityMessage,
  GetServiceIdentityMessage,
  UnlockInput,
} from '../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('identity handlers', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('handleGetServiceIdentity returns null before creation, the record after', async () => {
    const getMessage: GetServiceIdentityMessage = {
      type: 'GET_SERVICE_IDENTITY',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetServiceIdentity(getMessage)).toBeNull();

    const createMessage: CreateServiceIdentityMessage = {
      type: 'CREATE_SERVICE_IDENTITY',
      payload: { origin: 'https://example.com' },
    };
    const created = await handleCreateServiceIdentity(createMessage);

    expect(await handleGetServiceIdentity(getMessage)).toEqual(created);
  });

  it('handleCreateServiceIdentity is idempotent through the handler', async () => {
    const createMessage: CreateServiceIdentityMessage = {
      type: 'CREATE_SERVICE_IDENTITY',
      payload: { origin: 'https://example.com' },
    };
    const first = await handleCreateServiceIdentity(createMessage);
    const second = await handleCreateServiceIdentity(createMessage);
    expect(second).toEqual(first);
  });

  it('normalizes the origin at the handler boundary', async () => {
    const createMessage: CreateServiceIdentityMessage = {
      type: 'CREATE_SERVICE_IDENTITY',
      payload: { origin: 'https://Example.com:443/some/path' },
    };
    const created = await handleCreateServiceIdentity(createMessage);
    expect(created.origin).toBe('https://example.com');

    // A differently-cased, default-port, path-bearing form of the same
    // origin must resolve to the identical stored record.
    const getMessage: GetServiceIdentityMessage = {
      type: 'GET_SERVICE_IDENTITY',
      payload: { origin: 'HTTPS://EXAMPLE.COM' },
    };
    expect(await handleGetServiceIdentity(getMessage)).toEqual(created);
  });
});
