import { describe, expect, it, vi } from 'vitest';
import { generatePassword } from '../../../shared/passwordGenerator';

const CHARSET_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}',
);

describe('generatePassword', () => {
  it('defaults to length 20', () => {
    expect(generatePassword()).toHaveLength(20);
  });

  it('respects an explicit length', () => {
    expect(generatePassword(32)).toHaveLength(32);
    expect(generatePassword(1)).toHaveLength(1);
  });

  it('only uses characters from the documented charset', () => {
    const password = generatePassword(500);
    for (const char of password) {
      expect(CHARSET_CHARS.has(char)).toBe(true);
    }
  });

  it('calls crypto.getRandomValues, never Math.random', () => {
    const getRandomValuesSpy = vi.spyOn(crypto, 'getRandomValues');
    const mathRandomSpy = vi.spyOn(Math, 'random');

    generatePassword();

    expect(getRandomValuesSpy).toHaveBeenCalled();
    expect(mathRandomSpy).not.toHaveBeenCalled();

    getRandomValuesSpy.mockRestore();
    mathRandomSpy.mockRestore();
  });

  it('produces different output across calls', () => {
    // Astronomically unlikely to collide for a real RNG at this length --
    // a real regression (e.g. a broken/constant RNG mock) would fail this
    // reliably, not flakily.
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
