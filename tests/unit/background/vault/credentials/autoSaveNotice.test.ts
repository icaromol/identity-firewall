import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  setAutoSaveNotice,
  takeAutoSaveNotice,
} from '../../../../../background/vault/credentials/autoSaveNotice';
import { normalizeOrigin } from '../../../../../shared/origin';

describe('autoSaveNotice', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('takeAutoSaveNotice returns false when nothing was ever set', async () => {
    expect(await takeAutoSaveNotice(normalizeOrigin('https://example.com'))).toBe(false);
  });

  it('round-trips: set then take returns true once, then false', async () => {
    const origin = normalizeOrigin('https://example.com');
    await setAutoSaveNotice(origin);

    expect(await takeAutoSaveNotice(origin)).toBe(true);
    expect(await takeAutoSaveNotice(origin)).toBe(false);
  });

  it('tracks notices independently per origin', async () => {
    const a = normalizeOrigin('https://a.example.com');
    const b = normalizeOrigin('https://b.example.com');
    await setAutoSaveNotice(a);

    expect(await takeAutoSaveNotice(b)).toBe(false);
    expect(await takeAutoSaveNotice(a)).toBe(true);
  });

  // Matches background/badge.ts's own updateBadgeForTab convention: a
  // failure updating cosmetic, best-effort state must never propagate out
  // and turn an otherwise-successful auto-save into a reported failure
  // (found via manual review, not /code-review, while the review agents
  // were rate-limited).
  it('setAutoSaveNotice swallows a storage failure rather than throwing', async () => {
    vi.spyOn(fakeBrowser.storage.session, 'set').mockRejectedValueOnce(new Error('storage boom'));

    await expect(
      setAutoSaveNotice(normalizeOrigin('https://example.com')),
    ).resolves.toBeUndefined();
  });
});
