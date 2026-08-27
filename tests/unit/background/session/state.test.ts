import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSessionState, recordFormDetection } from '../../../../background/session/state';
import type { CanonicalOrigin } from '../../../../shared/origin';

describe('session state', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns an empty state when nothing has been recorded yet', async () => {
    expect(await getSessionState()).toEqual({ originForms: {} });
  });

  it('round-trips a single recorded origin', async () => {
    const origin = 'https://example.com' as CanonicalOrigin;
    await recordFormDetection(origin, 2, 1000);

    const state = await getSessionState();
    expect(state.originForms[origin]).toEqual({ formCount: 2, lastDetectedAt: 1000 });
  });

  it('accumulates multiple distinct origins rather than overwriting each other', async () => {
    const originA = 'https://a.example' as CanonicalOrigin;
    const originB = 'https://b.example' as CanonicalOrigin;

    await recordFormDetection(originA, 1, 100);
    await recordFormDetection(originB, 3, 200);

    const state = await getSessionState();
    expect(state.originForms[originA]).toEqual({ formCount: 1, lastDetectedAt: 100 });
    expect(state.originForms[originB]).toEqual({ formCount: 3, lastDetectedAt: 200 });
  });

  it('overwrites a previous record for the same origin on re-detection', async () => {
    const origin = 'https://example.com' as CanonicalOrigin;
    await recordFormDetection(origin, 1, 100);
    await recordFormDetection(origin, 5, 200);

    const state = await getSessionState();
    expect(state.originForms[origin]).toEqual({ formCount: 5, lastDetectedAt: 200 });
  });
});
