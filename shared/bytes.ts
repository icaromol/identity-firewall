// Base64 encode/decode for the raw byte buffers that cross every storage and
// message-passing boundary in this codebase (shared/vault-schema.ts's and
// shared/messages.ts's many `xxxB64` fields). Centralized once here so every
// future byte<->string conversion follows the same exact encoding, matching
// the same "one canonical function, everywhere" discipline as normalizeOrigin
// (shared/origin.ts) -- and usable from both background and popup/stores
// contexts, since M4's setup UI must base64-encode raw PRF bytes before they
// cross the message channel.
//
// Encodes in fixed-size chunks, not one String.fromCharCode(...bytes) spread
// over the whole buffer -- spread/apply on a large Uint8Array (an encrypted
// vault blob is easily larger than the ~65536-argument engine limit once
// personal data and a few service identities accumulate) throws RangeError:
// Maximum call stack size exceeded. A chunk size well under that limit keeps
// this fast (one function call per 8192 bytes, not per byte) while staying
// safe at any input size.

const CHUNK_SIZE = 8192;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
