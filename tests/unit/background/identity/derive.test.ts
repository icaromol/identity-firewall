import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  deriveServiceIdentityKeypair,
  wrapEd25519SeedAsPkcs8,
} from '../../../../background/identity/derive';
import { randomBytes } from '../../../../background/vault/crypto';
import { base64ToBytes } from '../../../../shared/bytes';
import { normalizeOrigin } from '../../../../shared/origin';

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);

const originA = normalizeOrigin('https://a.example');
const originB = normalizeOrigin('https://b.example');

describe('deriveServiceIdentityKeypair', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('derives the same identifierB64 across repeated calls with the same rootSecret and origin', async () => {
    const rootSecret = randomBytes(32);
    const first = await deriveServiceIdentityKeypair(rootSecret, originA);
    const second = await deriveServiceIdentityKeypair(rootSecret, originA);
    expect(second.identifierB64).toBe(first.identifierB64);
  });

  it('derives the same signature bytes across repeated calls (private key determinism)', async () => {
    const rootSecret = randomBytes(32);
    const message = new TextEncoder().encode('hello service identity');

    const first = await deriveServiceIdentityKeypair(rootSecret, originA);
    const second = await deriveServiceIdentityKeypair(rootSecret, originA);

    const sigA = await crypto.subtle.sign('Ed25519', first.privateKey, message);
    const sigB = await crypto.subtle.sign('Ed25519', second.privateKey, message);
    expect(new Uint8Array(sigB)).toEqual(new Uint8Array(sigA));
  });

  it('derives different identifierB64 for different origins', async () => {
    const rootSecret = randomBytes(32);
    const forA = await deriveServiceIdentityKeypair(rootSecret, originA);
    const forB = await deriveServiceIdentityKeypair(rootSecret, originB);
    expect(forB.identifierB64).not.toBe(forA.identifierB64);
  });

  it('derives different identifierB64 for different rootSecrets', async () => {
    const forFirst = await deriveServiceIdentityKeypair(randomBytes(32), originA);
    const forSecond = await deriveServiceIdentityKeypair(randomBytes(32), originA);
    expect(forSecond.identifierB64).not.toBe(forFirst.identifierB64);
  });

  it('produces a working keypair (sign/verify round trip)', async () => {
    const { privateKey, publicKey } = await deriveServiceIdentityKeypair(randomBytes(32), originA);
    const message = new TextEncoder().encode('hello service identity');

    const signature = await crypto.subtle.sign('Ed25519', privateKey, message);
    const valid = await crypto.subtle.verify('Ed25519', publicKey, signature, message);
    expect(valid).toBe(true);
  });

  it('returns a non-extractable private key', async () => {
    const { privateKey } = await deriveServiceIdentityKeypair(randomBytes(32), originA);
    await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toThrow();
  });

  it('identifierB64 matches a direct raw export of the returned publicKey', async () => {
    const { publicKey, identifierB64 } = await deriveServiceIdentityKeypair(
      randomBytes(32),
      originA,
    );
    const rawExport = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
    expect(base64ToBytes(identifierB64)).toEqual(rawExport);
  });
});

describe('wrapEd25519SeedAsPkcs8', () => {
  it('wraps a 32-byte seed into exactly 48 bytes', () => {
    const seed = randomBytes(32);
    expect(wrapEd25519SeedAsPkcs8(seed)).toHaveLength(48);
  });

  it('preserves the input seed unchanged as the last 32 bytes', () => {
    const seed = randomBytes(32);
    const wrapped = wrapEd25519SeedAsPkcs8(seed);
    expect(wrapped.subarray(16)).toEqual(seed);
  });

  it('uses the fixed RFC 8410 Ed25519 PKCS8 prefix for an unencrypted private key', () => {
    const wrapped = wrapEd25519SeedAsPkcs8(randomBytes(32));
    const expectedPrefix = hexToBytes('302e020100300506032b657004220420');
    expect(wrapped.subarray(0, 16)).toEqual(expectedPrefix);
  });
});
