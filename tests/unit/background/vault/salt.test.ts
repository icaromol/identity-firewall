import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getOrCreateFixedAppSalt } from '../../../../background/vault/salt';

describe('getOrCreateFixedAppSalt', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('generates and persists a salt on first call', async () => {
    const salt = await getOrCreateFixedAppSalt();

    expect(salt).toHaveLength(32);
    const stored = await fakeBrowser.storage.local.get('if_vault_salt_v1');
    expect(typeof stored.if_vault_salt_v1).toBe('string');
  });

  it('returns the identical salt on repeated calls', async () => {
    const first = await getOrCreateFixedAppSalt();
    const second = await getOrCreateFixedAppSalt();

    expect(second).toEqual(first);
  });

  it('returns the same salt for concurrent calls and only writes once', async () => {
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    const [first, second] = await Promise.all([
      getOrCreateFixedAppSalt(),
      getOrCreateFixedAppSalt(),
    ]);

    expect(second).toEqual(first);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });
});
