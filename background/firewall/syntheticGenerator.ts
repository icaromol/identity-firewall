// Generates the Synthetic ("plausible but fabricated") and Nonsense
// ("deliberately absurd") values data-model.md/privacy-model.md define.
// Never called for 'nationalId' -- responseAvailability.ts never offers
// Synthetic/Nonsense for a highlySensitive field, so reaching the default
// branch below is a real caller bug, not a case to silently paper over.

import { type CanonicalOrigin, normalizeOrigin } from '../../shared/origin';
import type { PersonalData } from '../../shared/vault-schema';
import { deriveHkdfBits } from '../vault/crypto';
import { getOrCreateFixedAppSalt } from '../vault/salt';

// crypto.randomUUID(), not a module-level counter -- this file runs in the
// MV3 service worker, and this project has been deliberately wary of
// module-level mutable state there ever since background/session/state.ts's
// own header comment (a real, shipped Attestto bug came from exactly that
// assumption). A random token needs no state to survive a restart.
function randomToken(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ADR-016 -- reuses ADR-010's exact HKDF-per-origin derivation pattern
// (background/identity/derive.ts's deriveServiceIdentityKeypair), for a
// different purpose: a stable per-(origin, fieldType) token instead of a
// keypair seed. `synthetic:` and the field type are folded into `info`
// alongside the origin (Service Identity derivation's own `info` is the
// origin alone) so this can never derive the same bytes as a Service
// Identity's seed for the same site -- domain separation between two
// different purposes sharing one root secret.
//
// 32 bits (4 bytes -> 8 hex characters) -- matches randomToken()'s own
// output length exactly (crypto.randomUUID()'s first 8 characters, always
// hex digits since a UUID's first hyphen falls at index 8), so switching
// the source doesn't change the shape of what a real site actually sees.
async function deriveSyntheticToken(
  rootSecret: Uint8Array,
  origin: CanonicalOrigin,
  fieldType: keyof PersonalData,
): Promise<string> {
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  const infoBytes = new TextEncoder().encode(`synthetic:${normalizeOrigin(origin)}:${fieldType}`);
  const bits = await deriveHkdfBits(rootSecret, fixedAppSalt, infoBytes, 32);
  return Array.from(bits, (b) => b.toString(16).padStart(2, '0')).join('');
}

// origin/rootSecret are only actually used for 'email' today -- the other
// fields (name/phone/address/birthDate) were never randomized in the first
// place (always the same static placeholder, regardless of site), so
// there was no non-determinism to fix for them. Making those genuinely
// site-varied AND still "plausible-looking" needs more than a raw derived
// token (a real name/address generator), which is its own, separate
// product problem -- left as a known, accepted gap, not silently assumed
// solved by this change.
export async function generateSyntheticValue(
  fieldType: keyof PersonalData,
  origin: CanonicalOrigin,
  rootSecret: Uint8Array,
): Promise<string> {
  switch (fieldType) {
    case 'name':
      return 'João Silva';
    case 'email': {
      // .invalid is the RFC 2606 reserved TLD -- guaranteed
      // non-deliverable, so a Synthetic email can never accidentally
      // route to a real domain.
      const token = await deriveSyntheticToken(rootSecret, origin, fieldType);
      return `synthetic.${token}@example.invalid`;
    }
    case 'phone':
      return '+55 11 90000-0000';
    case 'address':
      return 'Rua Exemplo, 123 - Bairro Central';
    case 'birthDate':
      return '1990-01-01';
    case 'nationalId':
      throw new Error(
        'generateSyntheticValue called for nationalId -- responseAvailability.ts should never offer Synthetic for a highlySensitive field',
      );
  }
}

// Deliberately UNCHANGED (ADR-016 decision 5) -- "deliberately absurd" has
// never carried a leak-detection claim, only Synthetic values have, so
// there's no correctness gap to close here.
export function generateNonsenseValue(fieldType: keyof PersonalData): string {
  switch (fieldType) {
    case 'name':
      return 'Xablau 9000';
    case 'email':
      return `nonsense.${randomToken()}@example.invalid`;
    case 'phone':
      return '+00 00 00000-0000';
    case 'address':
      return 'Rua Inexistente, 0';
    case 'birthDate':
      return '1900-01-01';
    case 'nationalId':
      throw new Error(
        'generateNonsenseValue called for nationalId -- responseAvailability.ts should never offer Nonsense for a highlySensitive field',
      );
  }
}
