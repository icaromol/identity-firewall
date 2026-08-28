import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../../../shared/bytes';

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
