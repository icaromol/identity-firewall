import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  decryptBlob,
  deriveHkdfBits,
  encryptBlob,
  generateAesGcmKeyFromBits,
  randomBytes,
} from '../../../../background/vault/crypto';
import { getOrCreateFixedAppSalt } from '../../../../background/vault/salt';
import { deriveSitePayloadKey } from '../../../../background/vault/siteKey';
import { normalizeOrigin } from '../../../../shared/origin';

const originA = normalizeOrigin('https://a.example');
const originB = normalizeOrigin('https://b.example');

// CryptoKey objects are never directly comparable, and encryptBlob uses a
// fresh random IV every call (by design -- AES-GCM security requires a
// unique IV per encryption), so comparing raw ciphertext bytes across two
// separate encrypt calls would never match even for the SAME key. Instead,
// determinism is checked by cross-decryption: encrypt with one key,
// decrypt with the other -- this only succeeds if both keys hold the
// identical underlying bits.
async function crossDecrypts(keyA: CryptoKey, keyB: CryptoKey): Promise<boolean> {
  const plaintext = new TextEncoder().encode('site payload key determinism fixture');
  const { iv, ciphertext } = await encryptBlob(keyA, plaintext);
  try {
    const decrypted = await decryptBlob(keyB, iv, ciphertext);
    return new TextDecoder().decode(decrypted) === 'site payload key determinism fixture';
  } catch {
    return false;
  }
}

describe('deriveSitePayloadKey', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('derives a key that can decrypt what it encrypted (round trip)', async () => {
    const key = await deriveSitePayloadKey(randomBytes(32), originA);
    const plaintext = new TextEncoder().encode('hello site payload');
    const { iv, ciphertext } = await encryptBlob(key, plaintext);
    const decrypted = await decryptBlob(key, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello site payload');
  });

  it('derives the same key across repeated calls with the same rootSecret and origin', async () => {
    const rootSecret = randomBytes(32);
    const first = await deriveSitePayloadKey(rootSecret, originA);
    const second = await deriveSitePayloadKey(rootSecret, originA);
    expect(await crossDecrypts(first, second)).toBe(true);
  });

  it('derives different keys for different origins', async () => {
    const rootSecret = randomBytes(32);
    const forA = await deriveSitePayloadKey(rootSecret, originA);
    const forB = await deriveSitePayloadKey(rootSecret, originB);
    expect(await crossDecrypts(forA, forB)).toBe(false);
  });

  it('derives different keys for different rootSecrets', async () => {
    const forFirst = await deriveSitePayloadKey(randomBytes(32), originA);
    const forSecond = await deriveSitePayloadKey(randomBytes(32), originA);
    expect(await crossDecrypts(forFirst, forSecond)).toBe(false);
  });

  it('derives a different key than identity/derive.ts would for the same rootSecret+origin (domain separation)', async () => {
    // A site payload key must never equal the raw HKDF output that seeds
    // that origin's Ed25519 identity keypair -- if it did, whoever holds
    // one would trivially derive the other. Reconstructs identity/derive.ts's
    // own bare-origin `info` string here (rather than importing its
    // internals) to keep this test a black-box check of the two modules'
    // independence, not a white-box peek at derive.ts's implementation.
    const rootSecret = randomBytes(32);
    const siteKey = await deriveSitePayloadKey(rootSecret, originA);

    const fixedAppSalt = await getOrCreateFixedAppSalt();
    const identityStyleBits = await deriveHkdfBits(
      rootSecret,
      fixedAppSalt,
      new TextEncoder().encode(originA),
      256,
    );
    const identityStyleKey = await generateAesGcmKeyFromBits(identityStyleBits);

    expect(await crossDecrypts(siteKey, identityStyleKey)).toBe(false);
  });
});
