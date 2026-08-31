import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { recordFormDetection } from '../../../../../background/session/state';
import {
  handleConfirmPendingCredential,
  handleDeleteCredential,
  handleDiscardPendingCredential,
  handleFillCredential,
  handleGetCredential,
  handleGetPendingCredential,
  handleSaveCredential,
} from '../../../../../background/vault/credentials/handler';
import { setPendingCredential } from '../../../../../background/vault/credentials/pendingCapture';
import { createRootIdentity } from '../../../../../background/vault/setup';
import type {
  ConfirmPendingCredentialMessage,
  DeleteCredentialMessage,
  DiscardPendingCredentialMessage,
  FillCredentialMessage,
  GetCredentialMessage,
  GetPendingCredentialMessage,
  SaveCredentialMessage,
  UnlockInput,
} from '../../../../../shared/messages';
import { normalizeOrigin } from '../../../../../shared/origin';
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

describe('pending credential handlers (Phase 5 M4)', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
    await createRootIdentity(passphraseInput);
  });

  it('handleGetPendingCredential returns null when nothing is staged', async () => {
    const message: GetPendingCredentialMessage = {
      type: 'GET_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetPendingCredential(message)).toBeNull();
  });

  it('handleGetPendingCredential returns a staged capture', async () => {
    const origin = normalizeOrigin('https://example.com');
    await setPendingCredential(origin, {
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });

    const message: GetPendingCredentialMessage = {
      type: 'GET_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetPendingCredential(message)).toEqual({
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });
  });

  it('handleConfirmPendingCredential saves through SAVE_CREDENTIAL and clears the staged capture', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);
    await setPendingCredential(normalizeOrigin('https://example.com'), {
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });

    const confirmMessage: ConfirmPendingCredentialMessage = {
      type: 'CONFIRM_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    };
    const saved = await handleConfirmPendingCredential(confirmMessage);
    expect(saved).toEqual({ kind: 'password', username: 'alice@example.com', password: 'hunter2' });

    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([saved]);

    const getPendingMessage: GetPendingCredentialMessage = {
      type: 'GET_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetPendingCredential(getPendingMessage)).toBeNull();
  });

  it('handleConfirmPendingCredential refuses when the tab has navigated away from the claimed origin', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://attacker.example/',
    } as never);
    await setPendingCredential(normalizeOrigin('https://example.com'), {
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });

    const confirmMessage: ConfirmPendingCredentialMessage = {
      type: 'CONFIRM_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    };
    await expect(handleConfirmPendingCredential(confirmMessage)).rejects.toThrow(
      /no longer showing origin/,
    );

    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([]);
  });

  it('handleConfirmPendingCredential refuses when nothing is staged', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);

    const confirmMessage: ConfirmPendingCredentialMessage = {
      type: 'CONFIRM_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    };
    await expect(handleConfirmPendingCredential(confirmMessage)).rejects.toThrow(
      /No pending credential/,
    );
  });

  it('handleDiscardPendingCredential clears the staged capture without saving it', async () => {
    await setPendingCredential(normalizeOrigin('https://example.com'), {
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });

    const discardMessage: DiscardPendingCredentialMessage = {
      type: 'DISCARD_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com', tabId: 1 },
    };
    await handleDiscardPendingCredential(discardMessage);

    const getPendingMessage: GetPendingCredentialMessage = {
      type: 'GET_PENDING_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetPendingCredential(getPendingMessage)).toBeNull();

    const getMessage: GetCredentialMessage = {
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    };
    expect(await handleGetCredential(getMessage)).toEqual([]);
  });
});

describe('handleFillCredential (Phase 5 M5)', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
    await createRootIdentity(passphraseInput);
  });

  const loginForm = {
    formIndex: 0,
    action: null,
    method: null,
    fields: [
      {
        tagName: 'input' as const,
        type: 'email',
        name: 'email',
        id: null,
        required: true,
        autocomplete: 'username',
        fieldType: 'email' as const,
        sensitivity: 'private' as const,
        apparentlyRequired: true,
      },
      {
        tagName: 'input' as const,
        type: 'password',
        name: 'password',
        id: null,
        required: true,
        autocomplete: 'current-password',
        fieldType: null,
        sensitivity: null,
        apparentlyRequired: true,
      },
    ],
  };

  it('relays AUTOFILL_FIELDS with the credential values when a login form is on the page', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);
    await recordFormDetection(normalizeOrigin('https://example.com'), [loginForm], 1, 0);
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockResolvedValue(true as never);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'password', username: 'alice@example.com', password: 'hunter2' },
      },
    };
    const result = await handleFillCredential(message);

    expect(result).toEqual({ filled: true });
    expect(sendMessageSpy).toHaveBeenCalledWith(1, {
      type: 'AUTOFILL_FIELDS',
      payload: {
        formIndex: 0,
        values: { '0:email': 'alice@example.com', '1:password': 'hunter2' },
      },
    });
  });

  it('returns filled: false when content/autofill.ts reports nothing was actually applied (a stale cached form)', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);
    await recordFormDetection(normalizeOrigin('https://example.com'), [loginForm], 1, 0);
    // The live page no longer matches the cached form (e.g. it navigated) --
    // applyAutofill's own reply says so.
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(false as never);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'password', username: 'alice@example.com', password: 'hunter2' },
      },
    };
    expect(await handleFillCredential(message)).toEqual({ filled: false });
  });

  it('omits the identifier value when the credential has no username', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);
    await recordFormDetection(normalizeOrigin('https://example.com'), [loginForm], 1, 0);
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockResolvedValue(true as never);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'password', username: null, password: 'hunter2' },
      },
    };
    await handleFillCredential(message);

    expect(sendMessageSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({ values: { '1:password': 'hunter2' } }),
      }),
    );
  });

  it('returns filled: false when no password-bearing form is on the page', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/',
    } as never);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'password', username: 'alice@example.com', password: 'hunter2' },
      },
    };
    expect(await handleFillCredential(message)).toEqual({ filled: false });
  });

  it('returns filled: false for a passkey credential (not fillable this way)', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/login',
    } as never);
    await recordFormDetection(normalizeOrigin('https://example.com'), [loginForm], 1, 0);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'passkey', rpId: 'example.com', credentialId: 'abc' },
      },
    };
    expect(await handleFillCredential(message)).toEqual({ filled: false });
  });

  it('refuses when the tab has navigated away from the claimed origin', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://attacker.example/',
    } as never);

    const message: FillCredentialMessage = {
      type: 'FILL_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        credential: { kind: 'password', username: 'alice@example.com', password: 'hunter2' },
      },
    };
    await expect(handleFillCredential(message)).rejects.toThrow(/no longer showing origin/);
  });
});
