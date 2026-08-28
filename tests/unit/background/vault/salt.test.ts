import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

describe('getOrCreateFixedAppSalt', () => {
  // getOrCreateFixedAppSalt caches its resolved value in a module-level
  // variable (safe in production since FixedAppSalt never changes for the
  // vault's lifetime -- see the function's own header comment), but that
  // means fakeBrowser.reset() alone isn't enough to isolate tests from each
  // other: the cache would otherwise survive across `it()` blocks in this
  // file even though storage was wiped. vi.resetModules() + a fresh dynamic
  // import per test restores full independence.
  let getOrCreateFixedAppSalt: typeof import('../../../../background/vault/salt').getOrCreateFixedAppSalt;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();
    ({ getOrCreateFixedAppSalt } = await import('../../../../background/vault/salt'));
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

  it('reads storage only once across repeated calls within the same module lifetime', async () => {
    const getSpy = vi.spyOn(fakeBrowser.storage.local, 'get');

    await getOrCreateFixedAppSalt();
    await getOrCreateFixedAppSalt();
    await getOrCreateFixedAppSalt();

    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
