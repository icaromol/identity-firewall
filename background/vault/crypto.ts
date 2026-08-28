// Pure Web Crypto primitives -- no storage, no semantic key names (those are
// keys.ts's job). HKDF construction and AES-GCM round-trip/tamper-rejection
// verified this session against Node's real WebCrypto: HKDF-SHA256 reproduces
// RFC 5869 Test Case 1 exactly; a flipped ciphertext byte causes decrypt to
// reject with OperationError (AES-GCM's authentication tag doing its job).
//
// `as BufferSource` casts below are a TS-only concession, not a runtime one:
// TypeScript 5.7+'s lib.dom.d.ts narrowed BufferSource to require a
// Uint8Array's generic buffer parameter to be exactly ArrayBuffer, but a bare
// `Uint8Array` parameter/return annotation (used everywhere in this codebase
// for ergonomics) defaults that generic to the wider ArrayBufferLike. Every
// Uint8Array this codebase ever constructs is genuinely ArrayBuffer-backed
// (SharedArrayBuffer is never used anywhere here) -- the cast just tells the
// compiler what's already true at runtime, confined to this one file so the
// stricter generic never has to propagate through every function signature
// in the codebase.

export async function deriveHkdfBits(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    lengthBits,
  );
  return new Uint8Array(bits);
}

// extractable: false always -- nothing downstream needs to export a
// VaultUnlockKey/BackupExportKey back out to raw bytes.
export async function generateAesGcmKeyFromBits(bits: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bits as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptBlob(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(12); // fresh random IV every call, never caller-supplied/reused
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptBlob(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
