import { describe, expect, it } from 'vitest';
import { normalizeOrigin } from '../../../shared/origin';

describe('normalizeOrigin', () => {
  it('strips the default HTTPS port', () => {
    expect(normalizeOrigin('https://example.com:443/path')).toBe('https://example.com');
  });

  it('strips the default HTTP port', () => {
    expect(normalizeOrigin('http://example.com:80/path')).toBe('http://example.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeOrigin('http://localhost:5173/path')).toBe('http://localhost:5173');
  });

  it('lowercases the host', () => {
    expect(normalizeOrigin('https://Example.COM/path')).toBe('https://example.com');
  });

  it('ignores the path, query, and hash', () => {
    const a = normalizeOrigin('https://example.com:443/path');
    const b = normalizeOrigin('https://example.com/other-path?x=1#frag');
    expect(a).toBe(b);
  });

  it('treats different ports as different origins', () => {
    expect(normalizeOrigin('http://localhost:3000/')).not.toBe(
      normalizeOrigin('http://localhost:5173/'),
    );
  });
});
