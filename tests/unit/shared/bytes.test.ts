import { describe, expect, it } from 'vitest';
import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from '../../../shared/bytes';

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(roundTripped).toEqual(original);
  });

  it('round-trips a buffer larger than the spread-argument call-stack limit', () => {
    // crypto.getRandomValues() itself caps out at 65536 bytes per call, so a
    // deterministic fill (not randomness) is what actually exercises size here.
    const original = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(roundTripped).toEqual(original);
  });

  it.each([0, 1, 2, 3])('round-trips a %i-byte buffer', (length) => {
    const original = crypto.getRandomValues(new Uint8Array(length));
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(roundTripped).toEqual(original);
  });

  it('round-trips a buffer whose length is exactly one chunk boundary', () => {
    const original = Uint8Array.from({ length: 8192 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
  });

  it('round-trips a buffer one byte past a chunk boundary', () => {
    const original = Uint8Array.from({ length: 8193 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
  });

  it('matches a known base64 vector', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(bytesToBase64(bytes)).toBe('aGVsbG8=');
    expect(base64ToBytes('aGVsbG8=')).toEqual(bytes);
  });
});

describe('base64UrlToBytes', () => {
  // Known vectors below (confirmed via Node's Buffer.from(...).toString('base64url'))
  // rather than round-tripping through an encoder -- this codebase has no
  // bytesToBase64Url: every base64url value it ever handles (WebAuthn's
  // PublicKeyCredential.id) arrives already-encoded by the browser, so only
  // the decode direction is real production code (/code-review).

  it('decodes a known vector without padding', () => {
    expect(base64UrlToBytes('aGVsbG8')).toEqual(new TextEncoder().encode('hello'));
  });

  it('decodes the url-safe alphabet correctly, not just standard base64', () => {
    // "-_-_-_-_ " is base64url for these bytes; the equivalent standard
    // base64 ("+/+/+/+/ ") would decode to something else entirely if this
    // function ever silently treated '-'/'_' as ordinary characters instead
    // of translating them to '+'/'/'.
    expect(base64UrlToBytes('-_-_-_-_')).toEqual(
      new Uint8Array([0xfb, 0xff, 0xbf, 0xfb, 0xff, 0xbf]),
    );
  });

  it('decodes known vectors at every possible padding-length remainder', () => {
    expect(base64UrlToBytes('AQ')).toEqual(new Uint8Array([1]));
    expect(base64UrlToBytes('AQI')).toEqual(new Uint8Array([1, 2]));
    expect(base64UrlToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64UrlToBytes('AQIDBA')).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(base64UrlToBytes('AQIDBAU')).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('round-trips through standard base64ToBytes/bytesToBase64 for the same underlying bytes', () => {
    // Cheap cross-check that base64UrlToBytes and the standard codec agree
    // on what bytes a value represents, using bytesToBase64's own encoder
    // (translating its '+'/'/' output to '-'/'_' by hand) rather than a
    // second, removed encoder.
    const original = crypto.getRandomValues(new Uint8Array(20));
    const standardB64 = bytesToBase64(original);
    const asBase64Url = standardB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(base64UrlToBytes(asBase64Url)).toEqual(original);
  });
});
