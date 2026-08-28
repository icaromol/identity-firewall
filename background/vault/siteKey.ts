// Per-site payload key (Tier 3, ADR-015) -- an AES-256-GCM key derived on
// demand from RootSecret + FixedAppSalt + origin, the same HKDF pattern
// ADR-010 already uses for the per-origin Ed25519 identity
// (background/identity/derive.ts), applied to a symmetric key instead.
// Never persisted or cached -- re-derived every time a site's Tier 3
// payload needs to be read or written, matching identity/derive.ts's own
// "never cache a derived key, re-derive on demand" rule.

import { type CanonicalOrigin, normalizeOrigin } from '../../shared/origin';
import { deriveHkdfBits, generateAesGcmKeyFromBits } from './crypto';
import { getOrCreateFixedAppSalt } from './salt';

// A prefix, not the bare origin -- identity/derive.ts's own HKDF `info` IS
// the bare origin string. If this derivation used the same bare origin as
// its info with the same rootSecret/FixedAppSalt (ikm/salt), it would
// produce the IDENTICAL 256 derived bits identity/derive.ts turns into that
// origin's Ed25519 seed -- a critical domain-separation bug, not a cosmetic
// one: whoever holds a site's payload key would trivially hold its Service
// Identity private key too. Distinct from keys.ts's own personalization
// strings for the same reason.
const SITE_PAYLOAD_INFO_PREFIX = 'identity-firewall:site-payload:v1:';

export async function deriveSitePayloadKey(
  rootSecret: Uint8Array,
  origin: CanonicalOrigin,
): Promise<CryptoKey> {
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  // normalizeOrigin is idempotent (verified empirically, identity/derive.ts's
  // own precedent), but CanonicalOrigin is a TypeScript-only brand with zero
  // runtime enforcement -- cheap insurance to normalize here too, not trust
  // the type alone.
  const infoBytes = new TextEncoder().encode(
    `${SITE_PAYLOAD_INFO_PREFIX}${normalizeOrigin(origin)}`,
  );
  const bits = await deriveHkdfBits(rootSecret, fixedAppSalt, infoBytes, 256);
  return generateAesGcmKeyFromBits(bits);
}
