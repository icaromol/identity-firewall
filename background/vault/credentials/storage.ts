// Reads/writes the credentials array nested inside each origin's Tier 3
// site payload (ADR-015), via vault/storage.ts's readSitePayload/
// updateSitePayload(WithResult) -- never the index's other entries or
// other sites' payloads.

import { base64ToBytes } from '../../../shared/bytes';
import type { CanonicalOrigin } from '../../../shared/origin';
import type { CredentialRecord, ServiceIdentityMeta } from '../../../shared/vault-schema';
import { createServiceIdentity } from '../../identity/storage';
import { deriveSitePayloadKey } from '../siteKey';
import {
  readSitePayload,
  readVaultIndex,
  updateSitePayload,
  updateSitePayloadWithResult,
} from '../storage';

// Resolves BOTH a ServiceIdentityMeta and its derived site-payload key
// together from a single index read -- deriving the key needs RootSecret
// (index.rootIdentity), and locating the payload needs the meta entry's
// payloadStorageKey (also in the index), so one read serves both. Returns
// null if the origin has never had a Service Identity created for it.
async function resolveSite(
  origin: CanonicalOrigin,
): Promise<{ meta: ServiceIdentityMeta; siteKey: CryptoKey } | null> {
  const index = await readVaultIndex();
  const meta = index.serviceIdentities[origin];
  if (!meta) {
    return null;
  }
  const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);
  const siteKey = await deriveSitePayloadKey(rootSecret, origin);
  return { meta, siteKey };
}

export async function getCredentials(origin: CanonicalOrigin): Promise<CredentialRecord[]> {
  const site = await resolveSite(origin);
  if (!site) {
    return [];
  }
  const payload = await readSitePayload(site.meta.payloadStorageKey, site.siteKey);
  return payload.credentials;
}

export async function saveCredential(
  origin: CanonicalOrigin,
  credential: CredentialRecord,
): Promise<CredentialRecord> {
  // createServiceIdentity is idempotent and, since the vault tiering
  // refactor, already creates BOTH the index entry and an empty Tier 3
  // site payload in one call (identity/storage.ts, Step 5) -- reusing it
  // here is simpler and safer than the pre-tiering design, which avoided a
  // separate create-then-save step specifically to dodge a two-write race
  // that could leave an orphaned empty record with no credential ever
  // saved. That race is no longer dangerous: index and site-payload are now
  // genuinely separate encrypted blobs, so "identity exists with an empty
  // payload" is itself a valid, retriable state, not a broken one -- if
  // another message lands between createServiceIdentity's write and this
  // function's own site-payload write below, the worst case is simply that
  // the credential isn't saved YET, exactly as if this whole call hadn't
  // run at all.
  const meta = await createServiceIdentity(origin);
  const index = await readVaultIndex();
  const rootSecret = base64ToBytes(index.rootIdentity.rootSecretB64);
  const siteKey = await deriveSitePayloadKey(rootSecret, origin);

  return updateSitePayloadWithResult(meta.payloadStorageKey, siteKey, (draft) => {
    const filtered = draft.credentials.filter((c) => c.kind !== credential.kind);
    return { next: { ...draft, credentials: [...filtered, credential] }, result: credential };
  });
}

export async function deleteCredential(
  origin: CanonicalOrigin,
  kind: CredentialRecord['kind'],
): Promise<void> {
  const site = await resolveSite(origin);
  if (!site) {
    return; // origin never had a Service Identity created -- nothing to delete
  }

  // Fast-path: skip the write-queue/re-encrypt entirely when there's
  // nothing to remove, same idempotency pattern as identity/storage.ts's
  // createServiceIdentity.
  const existingPayload = await readSitePayload(site.meta.payloadStorageKey, site.siteKey);
  if (!existingPayload.credentials.some((c) => c.kind === kind)) {
    return;
  }

  await updateSitePayload(site.meta.payloadStorageKey, site.siteKey, (draft) => {
    const filtered = draft.credentials.filter((c) => c.kind !== kind);
    if (filtered.length === draft.credentials.length) return draft; // already gone (race)
    return { ...draft, credentials: filtered };
  });
}
