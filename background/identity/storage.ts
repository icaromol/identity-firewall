// Reads/writes the ServiceIdentities index sub-tree via vault/storage.ts's
// readVaultIndex/updateVaultIndex (ADR-015's Tier 1) -- not a separate
// storage path, matching this project's "one write path per tier" rule.
// createServiceIdentity additionally initializes an empty Tier 3 site
// payload (vault/storage.ts's initializeSitePayload) for the newly-created
// origin, under a freshly-minted random payloadStorageKey -- never derived
// from the origin itself (ADR-015's own reasoning: a deterministic name,
// even hashed, would let mere read access to storage recover the site list
// from key NAMES, no decryption needed).

import { base64ToBytes } from '../../shared/bytes';
import type { CanonicalOrigin } from '../../shared/origin';
import type { ServiceIdentityMeta } from '../../shared/vault-schema';
import { deriveSitePayloadKey } from '../vault/siteKey';
import {
  initializeSitePayload,
  readVaultIndex,
  updateVaultIndexWithResult,
} from '../vault/storage';
import { deriveServiceIdentityKeypair } from './derive';

export async function getServiceIdentity(
  origin: CanonicalOrigin,
): Promise<ServiceIdentityMeta | null> {
  const index = await readVaultIndex();
  return index.serviceIdentities[origin] ?? null;
}

export async function createServiceIdentity(origin: CanonicalOrigin): Promise<ServiceIdentityMeta> {
  // Fast path: skip the Ed25519 derivation AND the write-queue/re-encrypt
  // entirely when the record already exists -- updateVaultIndex always
  // re-encrypts and persists the whole index after its mutator runs, even
  // when the mutator changes nothing, so a truly idempotent call must never
  // reach it at all (the same reasoning as M5's original version of this
  // function, before the vault tiering refactor).
  const existing = await getServiceIdentity(origin);
  if (existing) {
    return existing;
  }

  const index = await readVaultIndex();
  const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);
  const { identifierB64 } = await deriveServiceIdentityKeypair(rootSecret, origin);

  // A fresh random UUID, never derived from `origin` (ADR-015). Minted even
  // though a concurrent call for the same brand-new origin might mint its
  // OWN payloadStorageKey and lose the index-write race below -- see the
  // initializeSitePayload call's own comment for why that's an accepted,
  // storage-leak-only outcome, not a correctness bug.
  const payloadStorageKey = crypto.randomUUID();
  const siteKey = await deriveSitePayloadKey(rootSecret, origin);

  // Site payload initialized BEFORE the index entry, not after -- if this
  // succeeds but the index write below loses a race (another concurrent
  // create for the same origin wins first), the result is a harmless
  // orphaned empty payload blob under a random key nothing will ever
  // reference again. The reverse ordering would be worse: an index entry
  // pointing at a payloadStorageKey whose blob was never actually written,
  // which every future credential/alias read for this origin would hit as
  // an unexpected VaultNotInitializedError.
  await initializeSitePayload(payloadStorageKey, { origin, credentials: [], aliases: [] }, siteKey);

  // Captured from inside the mutator closure, not via a read-back call
  // after the write resolves -- updateVaultIndex's write-queue serializes
  // PERSISTED writes correctly, but a plain follow-up read is not part of
  // that queue, so another write could land in the gap between this write
  // resolving and a read-back completing, returning content this call
  // never wrote. The in-mutator existence check below also covers the race
  // between the fast-path check above and this write actually landing (a
  // concurrent create for the same origin completing first) -- in that
  // case, THIS call's freshly-initialized site payload above is the
  // orphaned one, and the returned meta points at the winning call's own
  // payload instead.
  return updateVaultIndexWithResult((draft) => {
    const existingInDraft = draft.serviceIdentities[origin];
    if (existingInDraft) {
      // idempotent: preserve its original createdAt/credentialKinds/etc.
      return { next: draft, result: existingInDraft };
    }
    const meta: ServiceIdentityMeta = {
      origin,
      identifierB64,
      createdAt: Date.now(),
      credentialKinds: [],
      aliasCount: 0,
      history: [],
      payloadStorageKey,
    };
    return {
      next: { ...draft, serviceIdentities: { ...draft.serviceIdentities, [origin]: meta } },
      result: meta,
    };
  });
}
