import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  handleGetPendingRequest,
  handleSubmitFieldDecisions,
} from '../../../../background/firewall/handler';
import { handleFormDetected } from '../../../../background/formDetection/handler';
import { setHighTrustOrigin, setPolicy } from '../../../../background/policy/storage';
import { setPersonalData } from '../../../../background/vault/personalData/storage';
import { createRootIdentity } from '../../../../background/vault/setup';
import { readVaultIndex } from '../../../../background/vault/storage';
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

// shared/fieldKey.ts's getFieldKey() always index-prefixes its key
// ('0:email' for the first field, not bare 'email') so two same-named
// fields in one form can never collide -- every form built by
// detectEmailForm() below has exactly one field, at index 0.
const EMAIL_FIELD_KEY = '0:email';

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

  it('reports isHighTrustOrigin and forces "ask" for a field even with a matching real policy', async () => {
    await detectEmailForm('https://gov.example');
    await setPersonalData({ email: 'user@example.com' });
    await setPolicy({ scope: { kind: 'global' }, fieldType: 'email', action: 'real' });
    await setHighTrustOrigin('https://gov.example', true);

    const result = await handleGetPendingRequest({
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://gov.example' },
    });

    expect(result?.isHighTrustOrigin).toBe(true);
    expect(result?.resolvedActions.email).toBe('ask');
  });

  it('reports isHighTrustOrigin: false for an ordinary origin', async () => {
    await detectEmailForm('https://example.com');

    const result = await handleGetPendingRequest({
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://example.com' },
    });

    expect(result?.isHighTrustOrigin).toBe(false);
  });
});

describe('handleSubmitFieldDecisions', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await createRootIdentity(passphraseInput);
    // fakeBrowser.tabs.get resolves to `undefined` for any id it doesn't
    // know about (no in-memory tab was ever created) rather than throwing
    // the way real chrome.tabs.get does for a closed tab -- mocked here so
    // every test in this block gets a tab whose url matches the origin
    // its own FORM_DETECTED call used, confirming the new tab-origin
    // re-check (a /code-review finding) doesn't mask what each test is
    // actually trying to verify.
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://example.com/signup',
    } as never);
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
        decisions: { [EMAIL_FIELD_KEY]: 'real' },
      },
    };
    const result = await handleSubmitFieldDecisions(message);

    expect(result.resolvedValues).toEqual({ [EMAIL_FIELD_KEY]: 'user@example.com' });
    expect(sendMessageSpy).toHaveBeenCalledWith(42, {
      type: 'AUTOFILL_FIELDS',
      payload: { formIndex: 0, values: { [EMAIL_FIELD_KEY]: 'user@example.com' } },
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
        decisions: { [EMAIL_FIELD_KEY]: 'deny' },
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
          decisions: { [EMAIL_FIELD_KEY]: 'real' }, // real is not allowed -- no value on file
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

  it('refuses to autofill when the tab has navigated away from the origin the decisions were made for', async () => {
    await detectEmailForm('https://example.com');
    await setPersonalData({ email: 'user@example.com' });

    // The tab is now showing a DIFFERENT origin than the one this
    // SUBMIT_FIELD_DECISIONS call claims -- simulates the popup staying
    // open across a navigation/redirect after origin/tabId were cached.
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      url: 'https://attacker.example/',
    } as never);

    await expect(
      handleSubmitFieldDecisions({
        type: 'SUBMIT_FIELD_DECISIONS',
        payload: {
          origin: 'https://example.com',
          tabId: 1,
          formIndex: 0,
          decisions: { [EMAIL_FIELD_KEY]: 'real' },
        },
      }),
    ).rejects.toThrow(/no longer showing origin/);
  });

  it('refuses to autofill when the tab no longer exists', async () => {
    await detectEmailForm('https://example.com');
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(undefined as never);

    await expect(
      handleSubmitFieldDecisions({
        type: 'SUBMIT_FIELD_DECISIONS',
        payload: {
          origin: 'https://example.com',
          tabId: 1,
          formIndex: 0,
          decisions: { [EMAIL_FIELD_KEY]: 'deny' },
        },
      }),
    ).rejects.toThrow(/no longer showing origin/);
  });

  it('records a Privacy Ledger entry reflecting the manual decision', async () => {
    await detectEmailForm('https://example.com');
    await setPersonalData({ email: 'user@example.com' });
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);

    await handleSubmitFieldDecisions({
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: {
        origin: 'https://example.com',
        tabId: 1,
        formIndex: 0,
        decisions: { [EMAIL_FIELD_KEY]: 'real' },
      },
    });

    const { privacyLedger } = await readVaultIndex();
    expect(privacyLedger).toHaveLength(1);
    expect(privacyLedger[0]).toMatchObject({
      origin: 'https://example.com',
      requestedFields: ['email'],
      disclosedFields: { email: 'real' },
      deniedFields: [],
      authorizationMethod: null,
    });
  });

  it('records a field with no decision made as denied in the Privacy Ledger', async () => {
    await detectEmailForm('https://example.com');
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);

    await handleSubmitFieldDecisions({
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: { origin: 'https://example.com', tabId: 1, formIndex: 0, decisions: {} },
    });

    const { privacyLedger } = await readVaultIndex();
    expect(privacyLedger[0]).toMatchObject({
      requestedFields: ['email'],
      disclosedFields: {},
      deniedFields: ['email'],
    });
  });
});
