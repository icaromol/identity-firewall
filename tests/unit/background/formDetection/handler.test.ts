import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleFormDetected } from '../../../../background/formDetection/handler';
import { getSessionState } from '../../../../background/session/state';
import type { FormDetectedMessage } from '../../../../shared/messages';

describe('handleFormDetected', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('records the detected origin and form count in session state', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://Example.com:443',
        url: 'https://example.com/login',
        detectedAt: 12345,
        forms: [
          {
            formIndex: 0,
            action: '/login',
            method: 'post',
            fields: [
              {
                tagName: 'input',
                type: 'email',
                name: 'email',
                id: null,
                required: true,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    };

    const result = await handleFormDetected(message);
    expect(result).toEqual({ recorded: true });

    const state = await getSessionState();
    // origin is normalized (default port stripped, lowercased) before being
    // used as a storage key -- see shared/origin.ts.
    expect(state.originForms['https://example.com']).toEqual({
      formCount: 1,
      lastDetectedAt: 12345,
    });
  });
});
