import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleFormDetected } from '../../../../background/formDetection/handler';
import { setHighTrustOrigin, setPolicy } from '../../../../background/policy/storage';
import { getSessionState } from '../../../../background/session/state';
import { setPersonalData } from '../../../../background/vault/personalData/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import { readVaultIndex } from '../../../../background/vault/storage';
import type { FormDetectedMessage, UnlockInput } from '../../../../shared/messages';

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

function emailFormMessage(origin: string): FormDetectedMessage {
  return {
    type: 'FORM_DETECTED',
    payload: {
      origin,
      url: `${origin}/signup`,
      detectedAt: 1,
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
}

describe('handleFormDetected', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('records the detected origin and form count in session state', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://Example.com:443',
        url: 'https://example.com/login',
        detectedAt: 12345,
        forms: [
          {
            formIndex: 0,
            action: '/login',
            method: 'post',
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

    // sender.tab left undefined -- this test isn't exercising the toolbar
    // badge (see badge-specific tests below), and the handler skips that
    // branch entirely without a tab id, so fakeBrowser needs no
    // browser.action stub here.
    const result = await handleFormDetected(message, { sender: {} });
    expect(result).toEqual({ recorded: true });

    const state = await getSessionState();
    // origin is normalized (default port stripped, lowercased) before being
    // used as a storage key -- see shared/origin.ts. The stored form is
    // classified (Phase 3), not just counted -- confirming handleFormDetected
    // actually runs the field through classifier.ts before persisting it.
    expect(state.originForms['https://example.com']).toEqual({
      forms: [
        {
          formIndex: 0,
          action: '/login',
          method: 'post',
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
      ],
      lastDetectedAt: 12345,
    });
  });

  it('sets the toolbar badge to the recognized-field count for the sending tab', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/signup',
        detectedAt: 1,
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
              {
                // Not recognized -- doesn't count towards the badge.
                tagName: 'textarea',
                type: null,
                name: 'message',
                id: null,
                required: false,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    };

    const ctx = { sender: { tab: { id: 7 } } } as Parameters<typeof handleFormDetected>[1];
    await handleFormDetected(message, ctx);

    expect(await fakeBrowser.action.getBadgeText({ tabId: 7 })).toBe('1');
  });

  it('clears the badge when no field on the page is recognized', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/contact',
        detectedAt: 1,
        forms: [
          {
            formIndex: 0,
            action: null,
            method: null,
            fields: [
              {
                tagName: 'textarea',
                type: null,
                name: 'message',
                id: null,
                required: false,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    };

    const ctx = { sender: { tab: { id: 8 } } } as Parameters<typeof handleFormDetected>[1];
    await handleFormDetected(message, ctx);

    expect(await fakeBrowser.action.getBadgeText({ tabId: 8 })).toBe('');
  });
});

describe('handleFormDetected -- Phase 4 automation path (vault unlocked)', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    // vi.spyOn on an already-mocked method doesn't reset its call history
    // on its own -- without this, a `not.toHaveBeenCalled()` assertion in
    // a later test could see a call left over from an earlier test's spy.
    vi.restoreAllMocks();
    await createRootIdentity(passphraseInput);
  });

  it('relays AUTOFILL_FIELDS and clears the badge when policy fully covers the form', async () => {
    await setPersonalData({ email: 'user@example.com' });
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'email', action: 'real' });

    const sendMessageSpy = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
    const ctx = { sender: { tab: { id: 9 } } } as Parameters<typeof handleFormDetected>[1];

    await handleFormDetected(emailFormMessage('https://example.com'), ctx);

    expect(sendMessageSpy).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        type: 'AUTOFILL_FIELDS',
        payload: expect.objectContaining({
          formIndex: 0,
          values: expect.objectContaining({ '0:email': 'user@example.com' }),
        }),
      }),
    );
    expect(await fakeBrowser.action.getBadgeText({ tabId: 9 })).toBe('');
  });

  it('records a Privacy Ledger entry for an automatic disclosure', async () => {
    await setPersonalData({ email: 'user@example.com' });
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'email', action: 'real' });
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);

    await handleFormDetected(emailFormMessage('https://example.com'), { sender: {} });

    const { privacyLedger } = await readVaultIndex();
    expect(privacyLedger).toHaveLength(1);
    expect(privacyLedger[0]).toMatchObject({
      origin: 'https://example.com',
      requestedFields: ['email'],
      disclosedFields: { email: 'real' },
      deniedFields: [],
    });
  });

  it('does not auto-fill and still shows a badge when the field has no matching policy', async () => {
    await setPersonalData({ email: 'user@example.com' });
    const sendMessageSpy = vi.spyOn(fakeBrowser.tabs, 'sendMessage');
    const ctx = { sender: { tab: { id: 10 } } } as Parameters<typeof handleFormDetected>[1];

    await handleFormDetected(emailFormMessage('https://example.com'), ctx);

    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(await fakeBrowser.action.getBadgeText({ tabId: 10 })).toBe('1');
  });

  it('a high-trust origin still shows a badge even with a matching global policy', async () => {
    await setPersonalData({ email: 'user@example.com' });
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'email', action: 'real' });
    await setHighTrustOrigin('https://gov.example', true);

    const sendMessageSpy = vi.spyOn(fakeBrowser.tabs, 'sendMessage');
    const ctx = { sender: { tab: { id: 11 } } } as Parameters<typeof handleFormDetected>[1];

    await handleFormDetected(emailFormMessage('https://gov.example'), ctx);

    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(await fakeBrowser.action.getBadgeText({ tabId: 11 })).toBe('1');
  });
});
