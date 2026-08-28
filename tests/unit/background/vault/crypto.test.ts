import { describe, expect, it } from 'vitest';
import {
  decryptBlob,
  deriveHkdfBits,
  encryptBlob,
  generateAesGcmKeyFromBits,
  randomBytes,
} from '../../../../background/vault/crypto';

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);

describe('deriveHkdfBits', () => {
  it('reproduces RFC 5869 Test Case 1 (HKDF-SHA256)', async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = hexToBytes('000102030405060708090a0b0c');
    const info = hexToBytes('f0f1f2f3f4f5f6f7f8f9');

    const okm = await deriveHkdfBits(ikm, salt, info, 42 * 8);

    expect(Buffer.from(okm).toString('hex')).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });
});

describe('encryptBlob / decryptBlob', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const key = await generateAesGcmKeyFromBits(randomBytes(32));
    const plaintext = new TextEncoder().encode('hello vault');

    const { iv, ciphertext } = await encryptBlob(key, plaintext);
    const decrypted = await decryptBlob(key, iv, ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('produces a different IV on each call', async () => {
    const key = await generateAesGcmKeyFromBits(randomBytes(32));
    const plaintext = new TextEncoder().encode('hello vault');

    const first = await encryptBlob(key, plaintext);
    const second = await encryptBlob(key, plaintext);

    expect(first.iv).not.toEqual(second.iv);
  });

  it('rejects decryption when a ciphertext byte is flipped', async () => {
    const key = await generateAesGcmKeyFromBits(randomBytes(32));
    const plaintext = new TextEncoder().encode('hello vault');

    const { iv, ciphertext } = await encryptBlob(key, plaintext);
    const tampered = ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    await expect(decryptBlob(key, iv, tampered)).rejects.toThrow();
  });

  it('rejects decryption under the wrong key', async () => {
    const key = await generateAesGcmKeyFromBits(randomBytes(32));
    const wrongKey = await generateAesGcmKeyFromBits(randomBytes(32));
    const plaintext = new TextEncoder().encode('hello vault');

    const { iv, ciphertext } = await encryptBlob(key, plaintext);

    await expect(decryptBlob(wrongKey, iv, ciphertext)).rejects.toThrow();
  });
});

describe('randomBytes', () => {
  it('returns the requested number of bytes', () => {
    expect(randomBytes(16)).toHaveLength(16);
  });

  it('returns different output across calls', () => {
    expect(randomBytes(16)).not.toEqual(randomBytes(16));
  });
});
