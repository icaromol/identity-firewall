import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { usePoliciesStore } from '../../../stores/policies.store';

describe('usePoliciesStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    setActivePinia(createPinia());
  });

  it('fetchPolicies loads policies and availableResponses on success', async () => {
    const data = {
      policies: [
        {
          scope: { kind: 'global' as const },
          fieldType: 'phone' as const,
          action: 'deny' as const,
        },
      ],
      availableResponses: { phone: ['deny'] } as never,
    };
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({ ok: true, data } as never);

    const store = usePoliciesStore();
    await store.fetchPolicies();

    expect(store.status).toBe('loaded');
    expect(store.policies).toEqual(data.policies);
    expect(store.availableResponses).toEqual(data.availableResponses);
  });

  it('sends GET_POLICIES on fetch', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: { policies: [], availableResponses: {} } } as never);

    const store = usePoliciesStore();
    await store.fetchPolicies();

    expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'GET_POLICIES', payload: {} });
  });

  it('sets status to error on a handler-level failure', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'VAULT_LOCKED',
    } as never);

    const store = usePoliciesStore();
    await store.fetchPolicies();

    expect(store.status).toBe('error');
    expect(store.error).toBe('VAULT_LOCKED');
  });

  it('setGlobalPolicy(fieldType, action) sends SET_POLICY with global scope', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: [] } as never);

    const store = usePoliciesStore();
    await store.setGlobalPolicy('email', 'alias');

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'SET_POLICY',
      payload: { scope: { kind: 'global' }, fieldType: 'email', action: 'alias' },
    });
  });

  it('setGlobalPolicy(fieldType, null) sends DELETE_POLICY with global scope', async () => {
    const sendMessageSpy = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockResolvedValueOnce({ ok: true, data: [] } as never);

    const store = usePoliciesStore();
    await store.setGlobalPolicy('email', null);

    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: 'DELETE_POLICY',
      payload: { scope: { kind: 'global' }, fieldType: 'email' },
    });
  });

  it('updates policies from the response on a successful setGlobalPolicy', async () => {
    const updated = [
      { scope: { kind: 'global' as const }, fieldType: 'email' as const, action: 'alias' as const },
    ];
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: true,
      data: updated,
    } as never);

    const store = usePoliciesStore();
    await store.setGlobalPolicy('email', 'alias');

    expect(store.policies).toEqual(updated);
    expect(store.saving).toBe(false);
    expect(store.saveError).toBeNull();
  });

  it('sets saveError on a handler-level failure and leaves policies untouched', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValueOnce({
      ok: false,
      error: 'boom',
    } as never);

    const store = usePoliciesStore();
    await store.setGlobalPolicy('email', 'alias');

    expect(store.saveError).toBe('boom');
    expect(store.policies).toEqual([]);
  });
});
