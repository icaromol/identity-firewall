import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearPendingCredential,
  getPendingCredential,
  setPendingCredential,
} from '../../../../../background/vault/credentials/pendingCapture';
import { normalizeOrigin } from '../../../../../shared/origin';

describe('pendingCapture', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns null when nothing is staged for an origin', async () => {
    expect(await getPendingCredential(normalizeOrigin('https://example.com'))).toBeNull();
  });

  it('stores and retrieves a staged credential', async () => {
    const origin = normalizeOrigin('https://example.com');
    await setPendingCredential(origin, {
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });

    expect(await getPendingCredential(origin)).toEqual({
      identifier: 'alice@example.com',
      password: 'hunter2',
      capturedAt: 1000,
    });
  });

  it('keeps different origins independent', async () => {
    const a = normalizeOrigin('https://a.example');
    const b = normalizeOrigin('https://b.example');
    await setPendingCredential(a, { identifier: 'a', password: 'pw-a', capturedAt: 1 });
    await setPendingCredential(b, { identifier: 'b', password: 'pw-b', capturedAt: 2 });

    expect(await getPendingCredential(a)).toMatchObject({ identifier: 'a' });
    expect(await getPendingCredential(b)).toMatchObject({ identifier: 'b' });
  });

  it('clearing one origin leaves others untouched', async () => {
    const a = normalizeOrigin('https://a.example');
    const b = normalizeOrigin('https://b.example');
    await setPendingCredential(a, { identifier: 'a', password: 'pw-a', capturedAt: 1 });
    await setPendingCredential(b, { identifier: 'b', password: 'pw-b', capturedAt: 2 });

    await clearPendingCredential(a);

    expect(await getPendingCredential(a)).toBeNull();
    expect(await getPendingCredential(b)).toMatchObject({ identifier: 'b' });
  });

  it('setting again for the same origin overwrites the previous capture', async () => {
    const origin = normalizeOrigin('https://example.com');
    await setPendingCredential(origin, { identifier: 'old', password: 'old-pw', capturedAt: 1 });
    await setPendingCredential(origin, { identifier: 'new', password: 'new-pw', capturedAt: 2 });

    expect(await getPendingCredential(origin)).toEqual({
      identifier: 'new',
      password: 'new-pw',
      capturedAt: 2,
    });
  });
});
