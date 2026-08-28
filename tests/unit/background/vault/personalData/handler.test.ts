import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleGetPersonalData,
  handleSetPersonalData,
} from '../../../../../background/vault/personalData/handler';
import { createRootIdentity } from '../../../../../background/vault/setup';
import type {
  GetPersonalDataMessage,
  SetPersonalDataMessage,
  UnlockInput,
} from '../../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

describe('personalData handlers', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('handleGetPersonalData returns {} before any set, the patched value after', async () => {
    const getMessage: GetPersonalDataMessage = { type: 'GET_PERSONAL_DATA', payload: {} };
    expect(await handleGetPersonalData(getMessage)).toEqual({});

    const setMessage: SetPersonalDataMessage = {
      type: 'SET_PERSONAL_DATA',
      payload: { name: 'Alice' },
    };
    await handleSetPersonalData(setMessage);

    expect(await handleGetPersonalData(getMessage)).toEqual({ name: 'Alice' });
  });

  it('handleSetPersonalData round-trips through the handler as a patch', async () => {
    await handleSetPersonalData({ type: 'SET_PERSONAL_DATA', payload: { name: 'Alice' } });
    const result = await handleSetPersonalData({
      type: 'SET_PERSONAL_DATA',
      payload: { email: 'alice@example.com' },
    });

    expect(result).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });
});
