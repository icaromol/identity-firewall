// Phase 5 M2 -- a local password generator. Pure, no I/O: takes a length,
// returns a string. Web Crypto's crypto.getRandomValues() is the ONLY
// randomness source (security-model.md's "never invent cryptography"
// stance, applied here even though a generated password isn't itself a
// cryptographic key -- this project's one and only source of randomness
// is Web Crypto, full stop, not Math.random for "less sensitive" uses).
//
// Charset and default length are documented in data-model.md, not just
// here -- the choice is product-facing (what a user's generated password
// actually looks like), not an implementation detail to bury in a comment
// only this file's reader would ever see.
const CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + 'abcdefghijklmnopqrstuvwxyz' + '0123456789' + '!@#$%^&*()-_=+[]{}';

// Rejection sampling, not a plain `byte % CHARSET.length` -- CHARSET.length
// (80) doesn't evenly divide 256, so a naive modulo would make the low 16
// charset entries (256 % 80 = 16) very slightly more likely to appear than
// the rest. REJECTION_THRESHOLD is the largest multiple of CHARSET.length
// that fits in a byte (240); any byte >= it is discarded and re-rolled,
// keeping every charset character equally likely.
const REJECTION_THRESHOLD = Math.floor(256 / CHARSET.length) * CHARSET.length;

// byte % CHARSET.length is always in [0, CHARSET.length), so this index is
// always valid -- but TypeScript's noUncheckedIndexedAccess can't see that
// invariant on its own. A loud throw here (structurally unreachable, same
// convention as syntheticGenerator.ts's nationalId branches) beats a
// silent non-null assertion Biome's own lint rules forbid anyway.
function charAt(index: number): string {
  const char = CHARSET[index];
  if (char === undefined) {
    throw new Error(`generatePassword: charset index ${index} out of bounds`);
  }
  return char;
}

export function generatePassword(length = 20): string {
  const result: string[] = [];

  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - result.length));
    for (const byte of bytes) {
      if (byte < REJECTION_THRESHOLD) {
        result.push(charAt(byte % CHARSET.length));
      }
    }
  }

  return result.join('');
}
