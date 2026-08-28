// Reads/writes the ServiceIdentities sub-tree via vault/storage.ts's
// readVaultData/updateVaultData -- not a separate storage path, per M5's
// own plan ("one write path" already established by M3).

import { base64ToBytes } from '../../shared/bytes';
import type { CanonicalOrigin } from '../../shared/origin';
import type { ServiceIdentityRecord } from '../../shared/vault-schema';
import { readVaultData, updateVaultDataWithResult } from '../vault/storage';
import { deriveServiceIdentityKeypair } from './derive';

export async function getServiceIdentity(
  origin: CanonicalOrigin,
): Promise<ServiceIdentityRecord | null> {
  const data = await readVaultData();
  return data.serviceIdentities[origin] ?? null;
}

export async function createServiceIdentity(
  origin: CanonicalOrigin,
): Promise<ServiceIdentityRecord> {
  // Fast path: skip the Ed25519 derivation AND the write-queue/re-encrypt
  // entirely when the record already exists -- updateVaultData always
  // re-encrypts and persists the whole blob after its mutator runs, even
  // when the mutator changes nothing, so a truly idempotent call must never
  // reach it at all (a /code-review finding).
  const existing = await getServiceIdentity(origin);
  if (existing) {
    return existing;
  }

  const data = await readVaultData();
  const rootSecret = base64ToBytes(data.rootIdentity.rootSecretB64);
  const { identifierB64 } = await deriveServiceIdentityKeypair(rootSecret, origin);

  // Captured from inside the mutator closure, not via a read-back call
  // after the write resolves -- updateVaultData's write-queue serializes
  // PERSISTED writes correctly, but a plain follow-up read is not part of
  // that queue, so another write could land in the gap between this write
  // resolving and a read-back completing, returning content this call
  // never wrote. The in-mutator existence check below also covers the race
  // between the fast-path check above and this write actually landing (a
  // concurrent create for the same origin completing in between).
  return updateVaultDataWithResult((draft) => {
    const existingInDraft = draft.serviceIdentities[origin];
    if (existingInDraft) {
      // idempotent: preserve its original createdAt/credentials/aliases
      return { next: draft, result: existingInDraft };
    }
    const record: ServiceIdentityRecord = {
      origin,
      identifierB64,
      createdAt: Date.now(),
      credentials: [],
      aliases: [],
      history: [],
    };
    return {
      next: { ...draft, serviceIdentities: { ...draft.serviceIdentities, [origin]: record } },
      result: record,
    };
  });
}
