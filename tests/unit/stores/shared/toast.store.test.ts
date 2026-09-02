import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../../../../stores/shared/toast.store';

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('push adds a toast with the given message and variant', () => {
    const store = useToastStore();
    store.push('Saved.', 'success');

    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0]).toMatchObject({ message: 'Saved.', variant: 'success' });
  });

  it('defaults to the "info" variant when none is given', () => {
    const store = useToastStore();
    store.push('Something happened');

    expect(store.toasts[0]?.variant).toBe('info');
  });

  it('assigns each toast a distinct id', () => {
    const store = useToastStore();
    store.push('First');
    store.push('Second');

    expect(store.toasts[0]?.id).not.toBe(store.toasts[1]?.id);
  });

  it('dismiss removes exactly the toast with the given id', () => {
    const store = useToastStore();
    store.push('First');
    store.push('Second');
    const [first, second] = store.toasts;

    store.dismiss(first?.id ?? '');

    expect(store.toasts).toEqual([second]);
  });

  it('auto-dismisses a toast after the timeout elapses', () => {
    const store = useToastStore();
    store.push('Temporary');
    expect(store.toasts).toHaveLength(1);

    vi.advanceTimersByTime(3000);

    expect(store.toasts).toHaveLength(0);
  });
});
