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

    // sender.tab left undefined -- this test isn't exercising the toolbar
    // badge (see badge-specific tests below), and the handler skips that
    // branch entirely without a tab id, so fakeBrowser needs no
    // browser.action stub here.
    const result = await handleFormDetected(message, { sender: {} });
    expect(result).toEqual({ recorded: true });

    const state = await getSessionState();
    // origin is normalized (default port stripped, lowercased) before being
    // used as a storage key -- see shared/origin.ts. The stored form is
    // classified (Phase 3), not just counted -- confirming handleFormDetected
    // actually runs the field through classifier.ts before persisting it.
    expect(state.originForms['https://example.com']).toEqual({
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
              fieldType: 'email',
              sensitivity: 'private',
              apparentlyRequired: true,
            },
          ],
        },
      ],
      lastDetectedAt: 12345,
    });
  });

  it('sets the toolbar badge to the recognized-field count for the sending tab', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/signup',
        detectedAt: 1,
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
              {
                // Not recognized -- doesn't count towards the badge.
                tagName: 'textarea',
                type: null,
                name: 'message',
                id: null,
                required: false,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    };

    const ctx = { sender: { tab: { id: 7 } } } as Parameters<typeof handleFormDetected>[1];
    await handleFormDetected(message, ctx);

    expect(await fakeBrowser.action.getBadgeText({ tabId: 7 })).toBe('1');
  });

  it('clears the badge when no field on the page is recognized', async () => {
    const message: FormDetectedMessage = {
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/contact',
        detectedAt: 1,
        forms: [
          {
            formIndex: 0,
            action: null,
            method: null,
            fields: [
              {
                tagName: 'textarea',
                type: null,
                name: 'message',
                id: null,
                required: false,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    };

    const ctx = { sender: { tab: { id: 8 } } } as Parameters<typeof handleFormDetected>[1];
    await handleFormDetected(message, ctx);

    expect(await fakeBrowser.action.getBadgeText({ tabId: 8 })).toBe('');
  });
});
