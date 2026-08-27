import { describe, expect, it } from 'vitest';
import { ExtensionMessageSchema } from '../../../shared/messages';

describe('ExtensionMessageSchema', () => {
  it('accepts a valid FORM_DETECTED message', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/login',
        detectedAt: Date.now(),
        forms: [
          {
            formIndex: 0,
            action: '/login',
            method: 'post',
            fields: [
              { tagName: 'input', type: 'email', name: 'email', id: null, required: true },
              { tagName: 'input', type: 'password', name: 'password', id: null, required: true },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid GET_SESSION_STATE message with no payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'GET_SESSION_STATE' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid GET_ORIGIN_STATE message', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'GET_ORIGIN_STATE',
      payload: { origin: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'NOT_A_REAL_TYPE', payload: {} });
    expect(result.success).toBe(false);
  });

  it('rejects FORM_DETECTED with a missing required field', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        // url is missing
        detectedAt: Date.now(),
        forms: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects FORM_DETECTED with a wrong field type', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/login',
        detectedAt: 'not-a-number',
        forms: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects GET_ORIGIN_STATE with no origin', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'GET_ORIGIN_STATE', payload: {} });
    expect(result.success).toBe(false);
  });
});
