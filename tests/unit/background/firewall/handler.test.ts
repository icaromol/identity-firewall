import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleGetPendingRequest } from '../../../../background/firewall/handler';
import { handleFormDetected } from '../../../../background/formDetection/handler';
import type { FormDetectedMessage, GetPendingRequestMessage } from '../../../../shared/messages';

describe('handleGetPendingRequest', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns the classified forms recorded for a normalized origin', async () => {
    const formDetected: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://Example.com:443',
        url: 'https://example.com/signup',
        detectedAt: 1000,
        forms: [
          {
            formIndex: 0,
            action: null,
            method: null,
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
    await handleFormDetected(formDetected);

    const message: GetPendingRequestMessage = {
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://example.com' },
    };
    const result = await handleGetPendingRequest(message);

    expect(result).toEqual([
      {
        formIndex: 0,
        action: null,
        method: null,
        fields: [
          {
            tagName: 'input',
            type: 'email',
            name: 'email',
            id: null,
            required: true,
            autocomplete: null,
            fieldType: 'email',
            sensitivity: 'private',
            apparentlyRequired: true,
          },
        ],
      },
    ]);
  });

  it('returns null for an origin with nothing detected this session', async () => {
    const message: GetPendingRequestMessage = {
      type: 'GET_PENDING_REQUEST',
      payload: { origin: 'https://nothing-here.example' },
    };
    expect(await handleGetPendingRequest(message)).toBeNull();
  });
});
