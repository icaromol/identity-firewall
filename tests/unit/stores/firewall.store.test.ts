import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getFieldKey } from '../../../shared/fieldKey';
import type { ClassifiedForm } from '../../../shared/messages';
import { useFirewallStore } from '../../../stores/firewall.store';

const activeTab = { id: 7, url: 'https://example.com/signup' };

// getFieldKey always index-prefixes (see shared/fieldKey.ts's own comment,
// added by a /code-review finding on same-named fields colliding) --
// sampleForms below has 'email' at index 0, 'newsletter' at index 1.
const emailKey = getFieldKey({ name: 'email', id: null }, 0);
const newsletterKey = getFieldKey({ name: 'newsletter', id: null }, 1);

function mockActiveTab() {
  // fakeBrowser.tabs.query's real in-memory implementation only knows
  // about tabs created via fakeBrowser.tabs.create -- mocked directly here
  // instead, matching session.store.test.ts's established convention for
  // fakeBrowser APIs that are awkward to drive through real state.
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([activeTab] as never);
}

const sampleForms = [
  {
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
        autocomplete: null,
        fieldType: 'email' as const,
        sensitivity: 'private' as const,
        apparentlyRequired: true,
      },
      {
        tagName: 'input' as const,
        type: 'text',
        name: 'newsletter',
        id: null,
        required: false,
        autocomplete: null,
        fieldType: null,
        sensitivity: null,
        apparentlyRequired: false,
      },
    ],
  },
];

describe('useFirewallStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
    // vi.spyOn on an already-mocked method doesn't reset its call history
    // on its own -- needed for the 'not.toHaveBeenCalled()' assertion
    // below to reflect only calls made within its own test.
    vi.restoreAllMocks();
  });

  it('derives origin/tabId from the active tab and loads forms + availableResponses', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.status).toBe('loaded');
    expect(store.origin).toBe('https://example.com');
    expect(store.tabId).toBe(7);
    expect(store.forms).toEqual(sampleForms);
    expect(store.availableResponses).toEqual({ email: ['real', 'deny'] });
  });

  it('sets status to error when there is no active tab', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValueOnce([] as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.status).toBe('error');
  });

  it('pre-fills a decision from resolvedActions when the Policy Engine resolves a field automatically', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: {
        forms: sampleForms,
        availableResponses: { email: ['real', 'synthetic', 'deny'] },
        resolvedActions: { email: 'real' },
      },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.getDecision(0, emailKey)).toBe('real');
    expect(store.getDecision(0, newsletterKey)).toBeUndefined(); // fieldType null -- untouched
  });

  it('defaults a field left at "ask" to \'deny\' -- the most privacy-preserving available response -- instead of leaving it blank', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: {
        forms: sampleForms,
        availableResponses: { email: ['real', 'synthetic', 'deny'] },
        resolvedActions: { email: 'ask' },
      },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.getDecision(0, emailKey)).toBe('deny');
  });

  it('does not default an "ask" field to deny when its availableResponses somehow omits deny', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: {
        forms: sampleForms,
        availableResponses: { email: ['real'] }, // malformed/incomplete on purpose
        resolvedActions: { email: 'ask' },
      },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.getDecision(0, emailKey)).toBeUndefined();
  });

  it('a manual choice for a field still left at "ask" survives a refresh, even though it started at the deny default', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({
        ok: true,
        data: {
          forms: sampleForms,
          availableResponses: { email: ['real', 'synthetic', 'deny'] },
          resolvedActions: {}, // ask -- defaults to 'deny'
          isHighTrustOrigin: false,
        },
      } as never)
      .mockResolvedValueOnce({ ok: true, data: ['https://example.com'] } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          forms: sampleForms,
          availableResponses: { email: ['real', 'synthetic', 'deny'] },
          resolvedActions: {}, // still ask after the refresh
          isHighTrustOrigin: true,
        },
      } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    expect(store.getDecision(0, emailKey)).toBe('deny'); // the default

    store.setDecision(0, emailKey, 'synthetic'); // the user's own manual override
    await store.toggleHighTrust();

    // Must still be the user's choice, not silently reset back to the
    // 'deny' default by the refresh's autoFilledKeys-clearing loop.
    expect(store.getDecision(0, emailKey)).toBe('synthetic');
  });

  it('applyDenyOptional only touches non-required fields', async () => {
    const formsWithOptionalEmail = [
      {
        formIndex: 0,
        action: null,
        method: null,
        fields: [
          {
            tagName: 'input' as const,
            type: 'email',
            name: 'email',
            id: null,
            required: false,
            autocomplete: null,
            fieldType: 'email' as const,
            sensitivity: 'private' as const,
            apparentlyRequired: false,
          },
          {
            tagName: 'input' as const,
            type: 'text',
            name: 'newsletter',
            id: null,
            required: false,
            autocomplete: null,
            fieldType: null,
            sensitivity: null,
            apparentlyRequired: false,
          },
        ],
      },
    ];
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: {
        forms: formsWithOptionalEmail,
        availableResponses: { email: ['real', 'deny'] },
        // An explicit stored policy resolves this optional field to
        // 'real' rather than leaving it at 'ask' (which would already
        // auto-default to 'deny' on load per the privacy-default-picker
        // behavior above) -- this is the actual case applyDenyOptional
        // exists for: overriding a policy-resolved non-deny decision in
        // one click, not re-stating a decision that's already 'deny'.
        resolvedActions: { email: 'real' },
      },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    expect(store.getDecision(0, emailKey)).toBe('real'); // policy-resolved, before the click

    const count = store.applyDenyOptional();

    expect(store.getDecision(0, emailKey)).toBe('deny');
    expect(count).toBe(1);
  });

  it('applyDenyOptional returns 0 when there are no optional fields to touch', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never); // sampleForms' one classified field (email) is required

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.applyDenyOptional()).toBe(0);
  });

  it('submitForm sends only the decisions actually set for that form, scoped by tabId/origin', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, emailKey, 'real');

    const submitSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { resolvedValues: { [emailKey]: 'a@b.com' } },
    } as never);

    await store.submitForm(0);

    expect(submitSpy).toHaveBeenCalledWith({
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: {
        origin: 'https://example.com',
        tabId: 7,
        formIndex: 0,
        decisions: { [emailKey]: 'real' },
      },
    });
    expect(store.submitErrors[0]).toBeUndefined();
  });

  it('submitForm records a handler-level error without throwing', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, emailKey, 'real');

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    await store.submitForm(0);

    expect(store.submitErrors[0]).toBe('boom');
  });

  it('scopes a submit error to the form that actually failed, not every pending form', async () => {
    const twoForms = [
      sampleForms[0] as ClassifiedForm,
      { formIndex: 1, action: null, method: null, fields: [] } as ClassifiedForm,
    ];
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: twoForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, emailKey, 'real');

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'form 0 failed',
    } as never);
    await store.submitForm(0);

    expect(store.submitErrors[0]).toBe('form 0 failed');
    expect(store.submitErrors[1]).toBeUndefined();
  });

  it('loads isHighTrustOrigin from the response', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: [], availableResponses: {}, isHighTrustOrigin: true },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    expect(store.isHighTrustOrigin).toBe(true);
  });

  it('toggleHighTrust sends SET_HIGH_TRUST_ORIGIN with the flipped value, then re-fetches without re-querying the tab', async () => {
    mockActiveTab();
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({
        ok: true,
        data: { forms: [], availableResponses: {}, isHighTrustOrigin: false },
      } as never)
      .mockResolvedValueOnce({ ok: true, data: ['https://example.com'] } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { forms: [], availableResponses: {}, isHighTrustOrigin: true },
      } as never);
    const tabsQuerySpy = vi.spyOn(fakeBrowser.tabs, 'query');

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    expect(store.isHighTrustOrigin).toBe(false);
    expect(tabsQuerySpy).toHaveBeenCalledTimes(1);

    await store.toggleHighTrust();

    // No second tabs.query -- tabId/origin are already known and don't
    // change just because safe mode toggled.
    expect(tabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).toHaveBeenNthCalledWith(2, {
      type: 'SET_HIGH_TRUST_ORIGIN',
      payload: { origin: 'https://example.com', tabId: 7, isHighTrust: true },
    });
    expect(store.isHighTrustOrigin).toBe(true);
    expect(store.highTrustError).toBeNull();
  });

  it("toggleHighTrust preserves a manually-set decision for a field the Policy Engine still leaves at 'ask'", async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({
        ok: true,
        data: {
          forms: sampleForms,
          availableResponses: { email: ['real', 'synthetic', 'deny'] },
          resolvedActions: {}, // email left at 'ask' -- no auto-fill
          isHighTrustOrigin: false,
        },
      } as never)
      .mockResolvedValueOnce({ ok: true, data: ['https://example.com'] } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          forms: sampleForms,
          availableResponses: { email: ['real', 'synthetic', 'deny'] },
          resolvedActions: {}, // still 'ask' after toggling -- unrelated to this field
          isHighTrustOrigin: true,
        },
      } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, emailKey, 'synthetic'); // the user's own manual choice

    await store.toggleHighTrust();

    expect(store.getDecision(0, emailKey)).toBe('synthetic');
  });

  it('toggleHighTrust records a handler-level error from SET_HIGH_TRUST_ORIGIN without throwing', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({
        ok: true,
        data: { forms: [], availableResponses: {}, isHighTrustOrigin: false },
      } as never)
      .mockResolvedValueOnce({ ok: false, error: 'boom' } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    await store.toggleHighTrust();

    expect(store.highTrustError).toBe('boom');
    expect(store.isHighTrustOrigin).toBe(false); // unchanged -- the write failed
  });

  it('toggleHighTrust does nothing when a toggle is already in flight', async () => {
    mockActiveTab();
    const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: [], availableResponses: {}, isHighTrustOrigin: false },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();

    store.togglingHighTrust = true;
    await store.toggleHighTrust();

    expect(sendMessageSpy).toHaveBeenCalledTimes(1); // only the initial fetch
  });

  it('toggleHighTrust does nothing when the origin is not yet known', async () => {
    const store = useFirewallStore();
    const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage');

    await store.toggleHighTrust();

    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});
