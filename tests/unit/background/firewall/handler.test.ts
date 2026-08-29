import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleGetPendingRequest,
  handleSubmitFieldDecisions,
} from '../../../../background/firewall/handler';
import { handleFormDetected } from '../../../../background/formDetection/handler';
import { setPersonalData } from '../../../../background/vault/personalData/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import type {
  FormDetectedMessage,
  GetPendingRequestMessage,
  SubmitFieldDecisionsMessage,
  UnlockInput,
} from '../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

// A ctx with no sender.tab -- the badge-setting branch (tested in
// tests/unit/background/formDetection/handler.test.ts) is irrelevant here.
const noTabCtx = { sender: {} } as Parameters<typeof handleFormDetected>[1];

async function detectEmailForm(origin: string) {
  const message: FormDetectedMessage = {
    type: 'FORM_DETECTED',
    payload: {
      origin,
      url: `${origin}/signup`,
      detectedAt: 1000,
      forms: [
        {
          formIndex: 0,
          action: null,
          method: null,
          fields: [
            {
              tagName: 'input',
              type: 'email',
              name: 'email',
              id: null,
              required: true,
              autocomplete: null,
            },
          ],
        },
      ],
    },
  };
  await handleFormDetected(message, noTabCtx);
}

describe('handleGetPendingRequest', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('returns the classified forms and per-fieldType availableResponses for a normalized origin', async () => {
    await detectEmailForm('https://Example.com:443');

    const message: GetPendingRequestMessage = {
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://example.com' },
    };
    const result = await handleGetPendingRequest(message);

    expect(result?.forms).toEqual([
      {
        formIndex: 0,
        action: null,
        method: null,
        fields: [
          {
            tagName: 'input',
            type: 'email',
            name: 'email',
            id: null,
            required: true,
            autocomplete: null,
            fieldType: 'email',
            sensitivity: 'private',
            apparentlyRequired: true,
          },
        ],
      },
    ]);
    // No PersonalData.email set yet, no alias provider configured --
    // real and alias are both excluded.
    expect(result?.availableResponses.email).toEqual(['synthetic', 'nonsense', 'deny']);
  });

  it('includes Real once PersonalData actually has a value for that field', async () => {
    await detectEmailForm('https://example.com');
    await setPersonalData({ email: 'user@example.com' });

    const result = await handleGetPendingRequest({
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://example.com' },
    });

    expect(result?.availableResponses.email).toEqual(['real', 'synthetic', 'nonsense', 'deny']);
  });

  it('returns null for an origin with nothing detected this session', async () => {
    const message: GetPendingRequestMessage = {
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://nothing-here.example' },
    };
    expect(await handleGetPendingRequest(message)).toBeNull();
  });
});

describe('handleSubmitFieldDecisions', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
  });

  it('resolves a Real decision from PersonalData and relays AUTOFILL_FIELDS to the given tab', async () => {
    await detectEmailForm('https://example.com');
    await setPersonalData({ email: 'user@example.com' });

    // fakeBrowser.tabs.sendMessage has no in-memory implementation (see
    // @webext-core/fake-browser's own thrown message) -- mocked directly,
    // matching tests/unit/stores/vault.store.test.ts's established
    // convention for other not-yet-implemented fakeBrowser APIs.
    const sendMessageSpy = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);

    const message: SubmitFieldDecisionsMessage = {
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: {
        origin: 'https://example.com',
        tabId: 42,
        formIndex: 0,
        decisions: { email: 'real' },
      },
    };
    const result = await handleSubmitFieldDecisions(message);

    expect(result.resolvedValues).toEqual({ email: 'user@example.com' });
    expect(sendMessageSpy).toHaveBeenCalledWith(42, {
      type: 'AUTOFILL_FIELDS',
      payload: { formIndex: 0, values: { email: 'user@example.com' } },
    });
  });

  it('omits a Deny decision from resolvedValues and from the relayed values', async () => {
    await detectEmailForm('https://example.com');
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);

    const result = await handleSubmitFieldDecisions({
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        formIndex: 0,
        decisions: { email: 'deny' },
      },
    });

    expect(result.resolvedValues).toEqual({});
  });

  it('rejects a response type the availability matrix does not allow for that field', async () => {
    await detectEmailForm('https://example.com'); // no PersonalData.email set

    await expect(
      handleSubmitFieldDecisions({
        type: 'SUBMIT_FIELD_DECISIONS',
        payload: {
          origin: 'https://example.com',
          tabId: 1,
          formIndex: 0,
          decisions: { email: 'real' }, // real is not allowed -- no value on file
        },
      }),
    ).rejects.toThrow();
  });

  it('throws for an unknown formIndex', async () => {
    await detectEmailForm('https://example.com');

    await expect(
      handleSubmitFieldDecisions({
        type: 'SUBMIT_FIELD_DECISIONS',
        payload: { origin: 'https://example.com', tabId: 1, formIndex: 99, decisions: {} },
      }),
    ).rejects.toThrow();
  });
});
