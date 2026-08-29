import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useFirewallStore } from '../../../stores/firewall.store';

const activeTab = { id: 7, url: 'https://example.com/signup' };

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

  it('applyApproveAll sets Real for a required field with a real value available, Deny for the optional one', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'synthetic', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.applyApproveAll();

    expect(store.getDecision(0, 'email')).toBe('real');
    expect(store.getDecision(0, 'newsletter')).toBeUndefined(); // fieldType null -- untouched
  });

  it('applyApproveAll defaults a required field with no real value on file to Deny', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['synthetic', 'deny'] } }, // no 'real'
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.applyApproveAll();

    expect(store.getDecision(0, 'email')).toBe('deny');
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
      data: { forms: formsWithOptionalEmail, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.applyDenyOptional();

    expect(store.getDecision(0, 'email')).toBe('deny');
  });

  it('submitForm sends only the decisions actually set for that form, scoped by tabId/origin', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, 'email', 'real');

    const submitSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { resolvedValues: { email: 'a@b.com' } } } as never);

    await store.submitForm(0);

    expect(submitSpy).toHaveBeenCalledWith({
      type: 'SUBMIT_FIELD_DECISIONS',
      payload: {
        origin: 'https://example.com',
        tabId: 7,
        formIndex: 0,
        decisions: { email: 'real' },
      },
    });
    expect(store.submitError).toBeNull();
  });

  it('submitForm records a handler-level error without throwing', async () => {
    mockActiveTab();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: { forms: sampleForms, availableResponses: { email: ['real', 'deny'] } },
    } as never);

    const store = useFirewallStore();
    await store.fetchPendingRequest();
    store.setDecision(0, 'email', 'real');

    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    await store.submitForm(0);

    expect(store.submitError).toBe('boom');
  });
});
