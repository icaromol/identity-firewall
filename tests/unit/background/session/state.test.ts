import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSessionState, recordFormDetection } from '../../../../background/session/state';
import type { ClassifiedForm } from '../../../../shared/messages';
import type { CanonicalOrigin } from '../../../../shared/origin';

// Minimal placeholder forms -- these tests exercise session-state
// storage/round-tripping, not classification itself (see
// tests/unit/background/firewall/classifier.test.ts for that), so the
// exact field content doesn't matter, only that `forms` round-trips
// faithfully and formCount can be derived from its length.
function makeForms(count: number): ClassifiedForm[] {
  return Array.from({ length: count }, (_, formIndex) => ({
    formIndex,
    action: null,
    method: null,
    fields: [],
  }));
}

describe('session state', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns an empty state when nothing has been recorded yet', async () => {
    expect(await getSessionState()).toEqual({ originForms: {} });
  });

  it('round-trips a single recorded origin', async () => {
    const origin = 'https://example.com' as CanonicalOrigin;
    await recordFormDetection(origin, makeForms(2), 1000);

    const state = await getSessionState();
    expect(state.originForms[origin]).toEqual({ forms: makeForms(2), lastDetectedAt: 1000 });
  });

  it('accumulates multiple distinct origins rather than overwriting each other', async () => {
    const originA = 'https://a.example' as CanonicalOrigin;
    const originB = 'https://b.example' as CanonicalOrigin;

    await recordFormDetection(originA, makeForms(1), 100);
    await recordFormDetection(originB, makeForms(3), 200);

    const state = await getSessionState();
    expect(state.originForms[originA]).toEqual({ forms: makeForms(1), lastDetectedAt: 100 });
    expect(state.originForms[originB]).toEqual({ forms: makeForms(3), lastDetectedAt: 200 });
  });

  it('overwrites a previous record for the same origin on re-detection', async () => {
    const origin = 'https://example.com' as CanonicalOrigin;
    await recordFormDetection(origin, makeForms(1), 100);
    await recordFormDetection(origin, makeForms(5), 200);

    const state = await getSessionState();
    expect(state.originForms[origin]).toEqual({ forms: makeForms(5), lastDetectedAt: 200 });
  });

  it('does not carry a recorded origin over into a later empty state', async () => {
    const origin = 'https://example.com' as CanonicalOrigin;
    await recordFormDetection(origin, makeForms(1), 100);
    await fakeBrowser.storage.session.clear();

    expect(await getSessionState()).toEqual({ originForms: {} });
  });

  it('does not lose an update when two calls race on different origins', async () => {
    const originA = 'https://a.example' as CanonicalOrigin;
    const originB = 'https://b.example' as CanonicalOrigin;

    await Promise.all([
      recordFormDetection(originA, makeForms(1), 100),
      recordFormDetection(originB, makeForms(3), 200),
    ]);

    const state = await getSessionState();
    expect(state.originForms[originA]).toEqual({ forms: makeForms(1), lastDetectedAt: 100 });
    expect(state.originForms[originB]).toEqual({ forms: makeForms(3), lastDetectedAt: 200 });
  });
});
