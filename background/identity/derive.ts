// Ed25519 keys for Service Identities (ADR-010, ADR-014). The PKCS8 wrapper
// below is a fixed, standard RFC 8410 §10.3 DER envelope -- data encoding,
// not hand-rolled cryptography; Web Crypto performs every actual
// cryptographic operation (validation, clamping, public-point computation,
// signing). Verified empirically this session: seed-only Ed25519 import via
// this exact wrapper is deterministic (both halves of the keypair -- the
// exported public key AND signatures produced by the private key are
// byte-identical across independent re-derivations from the same seed), and
// no other import path (raw, jwk-without-x) works for a seed-only private
// key. No @noble/curves fallback needed (ADR-014).
//
// The private key is NEVER persisted anywhere -- only identifierB64 (the
// public key) goes into ServiceIdentityRecord. Re-derive on demand via this
// function whenever the private key is needed again (e.g. future signing),
// never cache a CryptoKey -- this is what makes the vault "recoverable from
// RootSecret alone" (ADR-010).
//
// `as BufferSource` casts below match background/vault/crypto.ts's
// established pattern for TS 5.7+'s BufferSource strictness, confined to
// this one file -- see that file's header comment for the full explanation.

import { base64UrlToBytes, bytesToBase64 } from '../../shared/bytes';
import { type CanonicalOrigin, normalizeOrigin } from '../../shared/origin';
import { deriveHkdfBits } from '../vault/crypto';
import { getOrCreateFixedAppSalt } from '../vault/salt';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

// Exported so the DER envelope construction itself can be unit-tested
// directly (exact byte layout), not just indirectly through the full
// derivation pipeline -- the one piece of hand-constructed ASN.1 in an
// otherwise never-hand-roll-crypto codebase deserves its own regression
// guard.
export function wrapEd25519SeedAsPkcs8(seed: Uint8Array): Uint8Array {
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  return pkcs8;
}

export interface ServiceIdentityKeypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  identifierB64: string;
}

export async function deriveServiceIdentityKeypair(
  rootSecret: Uint8Array,
  origin: CanonicalOrigin,
): Promise<ServiceIdentityKeypair> {
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  // normalizeOrigin is idempotent (verified empirically), but CanonicalOrigin
  // is a TypeScript-only brand with zero runtime enforcement -- a caller that
  // skipped normalization wouldn't crash, it would silently derive a
  // different, wrong keypair with no error. Cheap insurance to normalize here
  // too, not trust the type alone.
  const infoBytes = new TextEncoder().encode(normalizeOrigin(origin));
  const seed = await deriveHkdfBits(rootSecret, fixedAppSalt, infoBytes, 256);
  const pkcs8Seed = wrapEd25519SeedAsPkcs8(seed);

  // Temporarily extractable ONLY to read the public key bytes -- no other
  // Web Crypto primitive computes a public key from a private one. Never
  // returned or persisted; goes out of scope immediately after this block.
  const extractablePrivateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Seed as BufferSource,
    'Ed25519',
    true,
    ['sign'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', extractablePrivateKey);
  if (!jwk.x) {
    throw new Error('Ed25519 public key missing from exported JWK');
  }
  const publicKeyBytes = base64UrlToBytes(jwk.x);

  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey('pkcs8', pkcs8Seed as BufferSource, 'Ed25519', false, ['sign']),
    crypto.subtle.importKey('raw', publicKeyBytes as BufferSource, 'Ed25519', true, ['verify']),
  ]);

  return { privateKey, publicKey, identifierB64: bytesToBase64(publicKeyBytes) };
}
