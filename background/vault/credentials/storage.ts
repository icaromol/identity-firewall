// Reads/writes the credentials array nested inside each ServiceIdentityRecord,
// via vault/storage.ts's readVaultData/updateVaultData -- not a separate
// storage path, same convention as background/identity/storage.ts (M5).

import { base64ToBytes } from '../../../shared/bytes';
import type { CanonicalOrigin } from '../../../shared/origin';
import type { CredentialRecord, ServiceIdentityRecord } from '../../../shared/vault-schema';
import { deriveServiceIdentityKeypair } from '../../identity/derive';
import { readVaultData, updateVaultData, updateVaultDataWithResult } from '../storage';

export async function getCredentials(origin: CanonicalOrigin): Promise<CredentialRecord[]> {
  const data = await readVaultData();
  return data.serviceIdentities[origin]?.credentials ?? [];
}

export async function saveCredential(
  origin: CanonicalOrigin,
  credential: CredentialRecord,
): Promise<CredentialRecord> {
  // Self-sufficient: creates the ServiceIdentityRecord if missing, in the
  // SAME updateVaultData call that sets the credential. Calling
  // identity/storage.ts's createServiceIdentity() as a separate step first
  // would be two independent write-queue round trips -- another message
  // (e.g. VAULT_LOCK) could land in the gap between them, leaving an
  // orphaned empty-credentials record persisted with no credential ever
  // saved (a real gap found by a Plan agent's critique before this shipped).
  const data = await readVaultData();
  const existingRecord = data.serviceIdentities[origin];
  let identifierB64 = existingRecord?.identifierB64;
  if (!identifierB64) {
    const rootSecret = base64ToBytes(data.rootIdentity.rootSecretB64);
    ({ identifierB64 } = await deriveServiceIdentityKeypair(rootSecret, origin));
  }

  return updateVaultDataWithResult((draft) => {
    const record: ServiceIdentityRecord = draft.serviceIdentities[origin] ?? {
      origin,
      identifierB64,
      createdAt: Date.now(),
      credentials: [],
      aliases: [],
      history: [],
    };
    const filtered = record.credentials.filter((c) => c.kind !== credential.kind);
    const updatedRecord = { ...record, credentials: [...filtered, credential] };
    return {
      next: {
        ...draft,
        serviceIdentities: { ...draft.serviceIdentities, [origin]: updatedRecord },
      },
      result: credential,
    };
  });
}

export async function deleteCredential(
  origin: CanonicalOrigin,
  kind: CredentialRecord['kind'],
): Promise<void> {
  // Fast-path: skip the write-queue/re-encrypt entirely when there's
  // nothing to remove, same idempotency pattern as identity/storage.ts's
  // createServiceIdentity.
  const existing = await getCredentials(origin);
  if (!existing.some((c) => c.kind === kind)) {
    return;
  }
  await updateVaultData((draft) => {
    const record = draft.serviceIdentities[origin];
    if (!record) return draft;
    const filtered = record.credentials.filter((c) => c.kind !== kind);
    if (filtered.length === record.credentials.length) return draft; // already gone (race)
    return {
      ...draft,
      serviceIdentities: {
        ...draft.serviceIdentities,
        [origin]: { ...record, credentials: filtered },
      },
    };
  });
}
