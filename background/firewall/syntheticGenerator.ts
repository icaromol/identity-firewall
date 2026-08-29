// Generates the Synthetic ("plausible but fabricated") and Nonsense
// ("deliberately absurd") values data-model.md/privacy-model.md define.
// Never called for 'nationalId' -- responseAvailability.ts never offers
// Synthetic/Nonsense for a highlySensitive field, so reaching the default
// branch below is a real caller bug, not a case to silently paper over.

import type { PersonalData } from '../../shared/vault-schema';

// crypto.randomUUID(), not a module-level counter -- this file runs in the
// MV3 service worker, and this project has been deliberately wary of
// module-level mutable state there ever since background/session/state.ts's
// own header comment (a real, shipped Attestto bug came from exactly that
// assumption). A random token needs no state to survive a restart.
function randomToken(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function generateSyntheticValue(fieldType: keyof PersonalData): string {
  switch (fieldType) {
    case 'name':
      return 'João Silva';
    case 'email':
      // .invalid is the RFC 2606 reserved TLD -- guaranteed
      // non-deliverable, so a Synthetic email can never accidentally
      // route to a real domain.
      return `synthetic.${randomToken()}@example.invalid`;
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
