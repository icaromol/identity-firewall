import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleGetOriginState } from '../../../../background/session/handler';
import { recordFormDetection } from '../../../../background/session/state';
import type { GetOriginStateMessage } from '../../../../shared/messages';
import type { CanonicalOrigin } from '../../../../shared/origin';

describe('handleGetOriginState', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('finds a record stored under the normalized origin when queried with a non-canonical form', async () => {
    await recordFormDetection('https://example.com' as CanonicalOrigin, 2, 1000);

    const message: GetOriginStateMessage = {
      type: 'GET_ORIGIN_STATE',
      payload: { origin: 'https://Example.com:443' },
    };

    expect(await handleGetOriginState(message)).toEqual({ formCount: 2, lastDetectedAt: 1000 });
  });

  it('returns null for an origin with no recorded forms', async () => {
    const message: GetOriginStateMessage = {
      type: 'GET_ORIGIN_STATE',
      payload: { origin: 'https://nothing-here.example' },
    };

    expect(await handleGetOriginState(message)).toBeNull();
  });
});
