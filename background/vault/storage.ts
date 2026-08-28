// The encrypted vault blob's read/write module, and the session-cached
// VaultUnlockKey. The only file that touches the encrypted vault blob or the
// unlock-key cache directly -- background/vault/salt.ts still owns
// FixedAppSalt via its own direct browser.storage.local calls, unchanged.
//
// updateVaultData is the one function allowed to MUTATE an existing vault
// blob -- every capability module (M5/M6/M7) funnels writes through it,
// never touching browser.storage.local directly. This is the structural fix
// for Attestto's dual-vault-drift bug (research/attestto-teardown.md §8):
// one write path, not a discipline to remember. initializeVaultData is kept
// as a separate function for the FIRST-EVER write, not folded into
// updateVaultData -- see its own comment below for why. Both funnel through
// the single private persistVaultData(), so "one write path" means one
// function, not just one name.
//
// getCachedUnlockKey/setCachedUnlockKey cache raw derived key BITS in
// browser.storage.session, never a CryptoKey object -- confirmed empirically
// this session that a CryptoKey's properties are WebIDL prototype accessors,
// not own-enumerable data, so storage's JSON-based serialization silently
// degrades one to `{}`. A fresh non-extractable CryptoKey is minted via
// generateAesGcmKeyFromBits on every read instead (see ADR-012's correction).

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { base64ToBytes, bytesToBase64 } from '../../shared/bytes';
import {
  type Argon2Params,
  Argon2ParamsSchema,
  type PersonalData,
  PersonalDataSchema,
  type SitePayload,
  SitePayloadSchema,
  type VaultData,
  VaultDataSchema,
  type VaultIndex,
  VaultIndexSchema,
} from '../../shared/vault-schema';
import { decryptBlob, encryptBlob, generateAesGcmKeyFromBits } from './crypto';
import { createSerialQueue } from './serialQueue';

const VAULT_BLOB_STORAGE_KEY = 'if_vault_blob_v1';
const UNLOCK_KEY_STORAGE_KEY = 'if_vault_unlock_key_v1';
const PASSPHRASE_KDF_STORAGE_KEY = 'if_vault_passphrase_kdf_v1';
const UNLOCK_METHOD_STORAGE_KEY = 'if_vault_unlock_method_v1';
const PASSKEY_CREDENTIAL_ID_STORAGE_KEY = 'if_vault_passkey_credential_id_v1';

export class VaultLockedError extends Error {
  constructor() {
    super('VAULT_LOCKED');
  }
}

export class VaultNotInitializedError extends Error {
  constructor() {
    super('VAULT_NOT_INITIALIZED');
  }
}

export class VaultAlreadyInitializedError extends Error {
  constructor() {
    super('VAULT_ALREADY_INITIALIZED');
  }
}

export class PassphraseArgon2ParamsCorruptedError extends Error {
  constructor() {
    super('PASSPHRASE_ARGON2_PARAMS_CORRUPTED');
  }
}

const EncryptedVaultBlobSchema = z.object({
  ivB64: z.string(),
  ciphertextB64: z.string(),
});

export async function vaultBlobExists(): Promise<boolean> {
  const stored = await browser.storage.local.get(VAULT_BLOB_STORAGE_KEY);
  return stored[VAULT_BLOB_STORAGE_KEY] !== undefined;
}

export async function getCachedUnlockKey(): Promise<CryptoKey | null> {
  const stored = await browser.storage.session.get(UNLOCK_KEY_STORAGE_KEY);
  const raw = stored[UNLOCK_KEY_STORAGE_KEY];
  if (typeof raw !== 'string') return null;
  try {
    return await generateAesGcmKeyFromBits(base64ToBytes(raw));
  } catch {
    // Malformed cached bits (wrong length, corrupted storage) are treated
    // exactly like no key cached at all -- either way the caller can't use
    // it, and this keeps every caller's error handling to the one
    // VaultLockedError contract instead of leaking a raw WebCrypto exception.
    return null;
  }
}

export async function setCachedUnlockKey(bits: Uint8Array): Promise<void> {
  await browser.storage.session.set({ [UNLOCK_KEY_STORAGE_KEY]: bytesToBase64(bits) });
}

export async function clearCachedUnlockKey(): Promise<void> {
  await browser.storage.session.remove(UNLOCK_KEY_STORAGE_KEY);
}

export async function decryptVaultDataWithKey(key: CryptoKey): Promise<VaultData> {
  const stored = await browser.storage.local.get(VAULT_BLOB_STORAGE_KEY);
  const parsed = EncryptedVaultBlobSchema.safeParse(stored[VAULT_BLOB_STORAGE_KEY]);
  if (!parsed.success) {
    throw new VaultNotInitializedError();
  }
  const iv = base64ToBytes(parsed.data.ivB64);
  const ciphertext = base64ToBytes(parsed.data.ciphertextB64);
  const plaintext = await decryptBlob(key, iv, ciphertext); // rejects with OperationError on a wrong key/corrupted data -- left unwrapped
  return VaultDataSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function persistVaultData(vaultData: VaultData, key: CryptoKey): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(vaultData));
  const { iv, ciphertext } = await encryptBlob(key, plaintext);
  await browser.storage.local.set({
    [VAULT_BLOB_STORAGE_KEY]: {
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(ciphertext),
    },
  });
}

// Serializes every write to the vault blob, generalizing
// background/session/state.ts's exact pattern from "per-origin map mutation"
// to "whole-vault-blob mutation".
const enqueue = createSerialQueue();

// For the FIRST-EVER write only (M4's createRootIdentity). Kept separate
// from updateVaultData rather than folded in: updateVaultData's mutator
// contract requires a full, already-valid VaultData as input, but
// RootIdentitySchema.rootSecretB64 is non-optional, so there is no valid
// placeholder "draft" a first-ever call could hand a mutator. Treating "no
// blob yet" and "blob exists but locked" as the same code path risks those
// two states someday being conflated -- a real vault silently reinitialized
// under some future refactor. Two named, differently-erroring functions is
// the safer structural choice, even though M4's own plan bullet describes
// initial creation as going "via updateVaultData" -- a deviation documented
// here rather than silently worked around.
export function initializeVaultData(vaultData: VaultData, key: CryptoKey): Promise<void> {
  return enqueue(async () => {
    if (await vaultBlobExists()) {
      throw new VaultAlreadyInitializedError();
    }
    const validated = VaultDataSchema.parse(vaultData);
    await persistVaultData(validated, key);
  });
}

export function updateVaultData(mutator: (draft: VaultData) => VaultData): Promise<void> {
  return enqueue(async () => {
    const key = await getCachedUnlockKey();
    if (!key) {
      throw new VaultLockedError();
    }
    const current = await decryptVaultDataWithKey(key);
    const next = VaultDataSchema.parse(mutator(current));
    await persistVaultData(next, key);
  });
}

// A variant of updateVaultData for mutators that also need to hand a value
// back to their caller (e.g. "the record that was created or already
// existed"). Introduced at M6 once a third near-identical
// `let result: T | undefined; ...; if (!result) throw ...` block appeared
// across background/identity/storage.ts, background/vault/credentials/
// storage.ts, and background/vault/personalData/storage.ts (a /code-review
// finding) -- factored into one place here rather than left as copy-pasted
// convention across three files. Wrapping `result` in `{ result: T }` avoids
// the `T | undefined` ambiguity a bare capture variable would have if some
// future T were itself legitimately undefined.
export async function updateVaultDataWithResult<T>(
  mutator: (draft: VaultData) => { next: VaultData; result: T },
): Promise<T> {
  let captured: { result: T } | undefined;
  await updateVaultData((draft) => {
    const { next, result } = mutator(draft);
    captured = { result };
    return next;
  });
  if (!captured) {
    // Unreachable in practice -- the mutator above always assigns captured
    // before its own return.
    throw new Error('updateVaultDataWithResult: mutator did not assign a result');
  }
  return captured.result;
}

export async function readVaultData(): Promise<VaultData> {
  const key = await getCachedUnlockKey();
  if (!key) {
    throw new VaultLockedError();
  }
  return decryptVaultDataWithKey(key);
}

export async function getPassphraseArgon2Params(): Promise<Argon2Params | undefined> {
  const stored = await browser.storage.local.get(PASSPHRASE_KDF_STORAGE_KEY);
  const raw = stored[PASSPHRASE_KDF_STORAGE_KEY];
  if (raw === undefined) {
    return undefined; // passphrase-unlock was never configured for this vault
  }
  const parsed = Argon2ParamsSchema.safeParse(raw);
  if (!parsed.success) {
    // Present but malformed is a distinct, real problem from "never
    // configured" -- silently falling back to DEFAULT_ARGON2_PARAMS here
    // would derive the wrong key from a correct passphrase, indistinguishable
    // from the user simply mistyping it.
    throw new PassphraseArgon2ParamsCorruptedError();
  }
  return parsed.data;
}

export async function setPassphraseArgon2Params(params: Argon2Params): Promise<void> {
  await browser.storage.local.set({ [PASSPHRASE_KDF_STORAGE_KEY]: params });
}

// Which unlock method a vault was configured with (M4) -- unencrypted,
// readable pre-unlock, same justification as FixedAppSalt/passphrase params.
// Without this, the popup has no real way to know whether to show the
// passkey or passphrase unlock form; inferring it from
// getPassphraseArgon2Params() returning non-undefined is only a side-channel
// guess that breaks the moment "ship both" (ADR-012) is ever read literally.
//
// getConfiguredUnlockMethod/getPasskeyCredentialId collapse "never
// configured" and "stored but fails schema validation" into the same
// undefined -- deliberately different from getPassphraseArgon2Params's
// explicit PassphraseArgon2ParamsCorruptedError throw above. The risk
// profiles differ: corrupted Argon2 params would silently derive the WRONG
// key from a genuinely correct passphrase (a real correctness landmine).
// Corrupted unlock-method/credential-id metadata just means the popup falls
// back to its already-designed "show both unlock forms" degradation --
// exactly the same UI it shows for "never configured" -- with no risk of
// deriving a wrong key, since unlockVault's passphrase path never reads
// this metadata at all, and its passkey path fails loudly (a clear "no
// credential configured" error) if credentialId is genuinely missing.
const UnlockMethodSchema = z.enum(['passkey', 'passphrase']);
export type ConfiguredUnlockMethod = z.infer<typeof UnlockMethodSchema>;

export async function getConfiguredUnlockMethod(): Promise<ConfiguredUnlockMethod | undefined> {
  const stored = await browser.storage.local.get(UNLOCK_METHOD_STORAGE_KEY);
  const parsed = UnlockMethodSchema.safeParse(stored[UNLOCK_METHOD_STORAGE_KEY]);
  return parsed.success ? parsed.data : undefined;
}

// The passkey credential's base64url id (WebAuthn spec, RFC 4648 §5), so a
// later unlock attempt can build allowCredentials without the popup needing
// to guess or rely on unverified discoverable-credential resolution.
export async function getPasskeyCredentialId(): Promise<string | undefined> {
  const stored = await browser.storage.local.get(PASSKEY_CREDENTIAL_ID_STORAGE_KEY);
  const raw = stored[PASSKEY_CREDENTIAL_ID_STORAGE_KEY];
  return typeof raw === 'string' ? raw : undefined;
}

// Writes the configured method and its matching credential/params in ONE
// browser.storage.local.set() call, not two sequential ones -- a
// /code-review finding: writing them separately left a real, if narrow,
// window where an interrupted setup (an MV3 service-worker restart is a
// normal lifecycle event, not a rare crash) could persist
// configuredUnlockMethod: 'passkey' with no matching passkeyCredentialId,
// permanently stranding the vault (initializeVaultData already succeeded,
// so a retry throws VaultAlreadyInitializedError with no repair path). A
// single multi-key .set() call is applied together by the browser, so
// method and its credential/params now always land or fail as one unit.
export async function setUnlockMethodMetadata(
  metadata:
    | { method: 'passphrase'; argon2Params: Argon2Params }
    | { method: 'passkey'; credentialId: string },
): Promise<void> {
  if (metadata.method === 'passphrase') {
    await browser.storage.local.set({
      [UNLOCK_METHOD_STORAGE_KEY]: metadata.method,
      [PASSPHRASE_KDF_STORAGE_KEY]: metadata.argon2Params,
    });
  } else {
    await browser.storage.local.set({
      [UNLOCK_METHOD_STORAGE_KEY]: metadata.method,
      [PASSKEY_CREDENTIAL_ID_STORAGE_KEY]: metadata.credentialId,
    });
  }
}

// ===========================================================================
// Three-tier vault storage (ADR-015, docs/plans/phase-2-vault-tiering-refactor.md).
//
// Everything above this line is the ORIGINAL whole-blob API (M3) --
// deliberately left in place and unused by the tiering refactor's Step 3,
// per that plan's own instruction: later steps (4-6) migrate every caller
// off it, and Step 6 deletes it once nothing references it anymore.
//
// Three independent encrypted surfaces, sharing the generic
// readEncryptedBlob/persistEncryptedBlob helpers below instead of each
// reimplementing "decrypt with schema validation" / "encrypt and persist":
//
//   Index (if_vault_index_v1)          -- RootIdentity + per-origin metadata
//   Personal data (if_vault_personal_data_v1) -- unchanged PersonalData shape, own key
//   Site payload (if_vault_site_<payloadStorageKey>_v1), one per origin -- real credential/alias values
//
// Each tier gets its own serializing queue (createSerialQueue(), the same
// primitive the old writeQueue above now uses) so an unrelated site's write
// never blocks on this site's write, or on an index/personal-data write --
// one global queue for the whole vault (the old behavior above) would
// serialize completely independent operations for no real reason.
//
// getCachedUnlockKey/setCachedUnlockKey/clearCachedUnlockKey above are
// UNCHANGED and shared by all three tiers below -- the session-cached-bits
// mechanism from M3 is orthogonal to how many encrypted blobs exist.

const VAULT_INDEX_STORAGE_KEY = 'if_vault_index_v1';
const PERSONAL_DATA_STORAGE_KEY = 'if_vault_personal_data_v1';
const sitePayloadStorageKey = (payloadStorageKey: string): string =>
  `if_vault_site_${payloadStorageKey}_v1`;

async function blobExists(storageKey: string): Promise<boolean> {
  const stored = await browser.storage.local.get(storageKey);
  return stored[storageKey] !== undefined;
}

async function readEncryptedBlob<T>(
  storageKey: string,
  schema: z.ZodType<T>,
  key: CryptoKey,
): Promise<T> {
  const stored = await browser.storage.local.get(storageKey);
  const parsed = EncryptedVaultBlobSchema.safeParse(stored[storageKey]);
  if (!parsed.success) {
    throw new VaultNotInitializedError();
  }
  const iv = base64ToBytes(parsed.data.ivB64);
  const ciphertext = base64ToBytes(parsed.data.ciphertextB64);
  const plaintext = await decryptBlob(key, iv, ciphertext); // rejects with OperationError on a wrong key/corrupted data -- left unwrapped, same convention as the whole-blob API above
  return schema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function persistEncryptedBlob<T>(storageKey: string, data: T, key: CryptoKey): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const { iv, ciphertext } = await encryptBlob(key, plaintext);
  await browser.storage.local.set({
    [storageKey]: { ivB64: bytesToBase64(iv), ciphertextB64: bytesToBase64(ciphertext) },
  });
}

// Shared by all three tiers' *WithResult variants below -- the same
// "capture a value out of a mutator, throw if it was somehow never
// assigned" pattern updateVaultDataWithResult (above) was built to
// deduplicate for ONE tier now needs deduplicating across THREE, so this
// generalizes over any update-shaped function rather than tripling that
// same block again.
async function withResult<D, T>(
  update: (mutator: (draft: D) => D) => Promise<void>,
  mutator: (draft: D) => { next: D; result: T },
): Promise<T> {
  let captured: { result: T } | undefined;
  await update((draft) => {
    const { next, result } = mutator(draft);
    captured = { result };
    return next;
  });
  if (!captured) {
    // Unreachable in practice -- the mutator above always assigns captured
    // before its own return.
    throw new Error('withResult: mutator did not assign a result');
  }
  return captured.result;
}

// --- Tier 1: Index ---

const indexQueue = createSerialQueue();

export async function vaultIndexExists(): Promise<boolean> {
  return blobExists(VAULT_INDEX_STORAGE_KEY);
}

// Explicit key, no lock check -- mirrors initializeVaultData above exactly:
// this runs during the FIRST-EVER write, before any key is cached.
export function initializeVaultIndex(index: VaultIndex, key: CryptoKey): Promise<void> {
  return indexQueue(async () => {
    if (await blobExists(VAULT_INDEX_STORAGE_KEY)) {
      throw new VaultAlreadyInitializedError();
    }
    const validated = VaultIndexSchema.parse(index);
    await persistEncryptedBlob(VAULT_INDEX_STORAGE_KEY, validated, key);
  });
}

export function updateVaultIndex(mutator: (draft: VaultIndex) => VaultIndex): Promise<void> {
  return indexQueue(async () => {
    const key = await getCachedUnlockKey();
    if (!key) {
      throw new VaultLockedError();
    }
    const current = await readEncryptedBlob(VAULT_INDEX_STORAGE_KEY, VaultIndexSchema, key);
    const next = VaultIndexSchema.parse(mutator(current));
    await persistEncryptedBlob(VAULT_INDEX_STORAGE_KEY, next, key);
  });
}

export function updateVaultIndexWithResult<T>(
  mutator: (draft: VaultIndex) => { next: VaultIndex; result: T },
): Promise<T> {
  return withResult(updateVaultIndex, mutator);
}

export async function readVaultIndex(): Promise<VaultIndex> {
  const key = await getCachedUnlockKey();
  if (!key) {
    throw new VaultLockedError();
  }
  return readEncryptedBlob(VAULT_INDEX_STORAGE_KEY, VaultIndexSchema, key);
}

// Takes an EXPLICIT key rather than the cached one -- mirrors
// decryptVaultDataWithKey above exactly, for the same reason: unlockVault
// (background/vault/unlock.ts) needs to verify a freshly-derived,
// not-yet-cached key by attempting to decrypt with it BEFORE caching
// anything, so it can't go through readVaultIndex's getCachedUnlockKey()
// gate (there's nothing cached yet at that point in the ceremony).
export async function decryptVaultIndexWithKey(key: CryptoKey): Promise<VaultIndex> {
  return readEncryptedBlob(VAULT_INDEX_STORAGE_KEY, VaultIndexSchema, key);
}

// --- Tier 2: Personal data ---

const personalDataQueue = createSerialQueue();

export function initializePersonalDataBlob(data: PersonalData, key: CryptoKey): Promise<void> {
  return personalDataQueue(async () => {
    if (await blobExists(PERSONAL_DATA_STORAGE_KEY)) {
      throw new VaultAlreadyInitializedError();
    }
    const validated = PersonalDataSchema.parse(data);
    await persistEncryptedBlob(PERSONAL_DATA_STORAGE_KEY, validated, key);
  });
}

export function updatePersonalDataBlob(
  mutator: (draft: PersonalData) => PersonalData,
): Promise<void> {
  return personalDataQueue(async () => {
    const key = await getCachedUnlockKey();
    if (!key) {
      throw new VaultLockedError();
    }
    const current = await readEncryptedBlob(PERSONAL_DATA_STORAGE_KEY, PersonalDataSchema, key);
    const next = PersonalDataSchema.parse(mutator(current));
    await persistEncryptedBlob(PERSONAL_DATA_STORAGE_KEY, next, key);
  });
}

export function updatePersonalDataBlobWithResult<T>(
  mutator: (draft: PersonalData) => { next: PersonalData; result: T },
): Promise<T> {
  return withResult(updatePersonalDataBlob, mutator);
}

export async function readPersonalDataBlob(): Promise<PersonalData> {
  const key = await getCachedUnlockKey();
  if (!key) {
    throw new VaultLockedError();
  }
  return readEncryptedBlob(PERSONAL_DATA_STORAGE_KEY, PersonalDataSchema, key);
}

// --- Tier 3: Site payload ---
//
// Unlike the index/personal-data tiers above, a site payload is NEVER
// encrypted with the cached VaultUnlockKey directly -- it's encrypted with
// a key derived on demand from RootSecret + origin
// (background/vault/siteKey.ts's deriveSitePayloadKey, Step 2), which the
// CALLER must derive and pass in explicitly (this module has no way to
// obtain RootSecret itself without first reading the index, and doing that
// here would couple this generic storage layer to identity-specific
// lookup logic that belongs in background/identity/storage.ts and
// background/vault/credentials/storage.ts, Step 5-6). Every function below
// still independently checks getCachedUnlockKey() as a defense-in-depth
// VaultLockedError guard -- structurally, a caller can only have obtained
// a valid siteKey by having already unlocked the vault to read the index
// first, but this makes that invariant explicit rather than assumed.
//
// One serializing queue PER payloadStorageKey, created on demand -- a
// single shared queue here would serialize completely unrelated sites'
// writes against each other for no reason (unlike the index/personal-data
// tiers above, where there is only ever one instance to serialize).
const sitePayloadQueues = new Map<string, ReturnType<typeof createSerialQueue>>();

function getSitePayloadQueue(payloadStorageKey: string): ReturnType<typeof createSerialQueue> {
  let queue = sitePayloadQueues.get(payloadStorageKey);
  if (!queue) {
    queue = createSerialQueue();
    sitePayloadQueues.set(payloadStorageKey, queue);
  }
  return queue;
}

export function initializeSitePayload(
  payloadStorageKey: string,
  data: SitePayload,
  siteKey: CryptoKey,
): Promise<void> {
  return getSitePayloadQueue(payloadStorageKey)(async () => {
    const unlockKey = await getCachedUnlockKey();
    if (!unlockKey) {
      throw new VaultLockedError();
    }
    const storageKey = sitePayloadStorageKey(payloadStorageKey);
    if (await blobExists(storageKey)) {
      throw new VaultAlreadyInitializedError();
    }
    const validated = SitePayloadSchema.parse(data);
    await persistEncryptedBlob(storageKey, validated, siteKey);
  });
}

export function updateSitePayload(
  payloadStorageKey: string,
  siteKey: CryptoKey,
  mutator: (draft: SitePayload) => SitePayload,
): Promise<void> {
  return getSitePayloadQueue(payloadStorageKey)(async () => {
    const unlockKey = await getCachedUnlockKey();
    if (!unlockKey) {
      throw new VaultLockedError();
    }
    const storageKey = sitePayloadStorageKey(payloadStorageKey);
    const current = await readEncryptedBlob(storageKey, SitePayloadSchema, siteKey);
    const next = SitePayloadSchema.parse(mutator(current));
    await persistEncryptedBlob(storageKey, next, siteKey);
  });
}

export function updateSitePayloadWithResult<T>(
  payloadStorageKey: string,
  siteKey: CryptoKey,
  mutator: (draft: SitePayload) => { next: SitePayload; result: T },
): Promise<T> {
  return withResult((m) => updateSitePayload(payloadStorageKey, siteKey, m), mutator);
}

export async function readSitePayload(
  payloadStorageKey: string,
  siteKey: CryptoKey,
): Promise<SitePayload> {
  const unlockKey = await getCachedUnlockKey();
  if (!unlockKey) {
    throw new VaultLockedError();
  }
  return readEncryptedBlob(sitePayloadStorageKey(payloadStorageKey), SitePayloadSchema, siteKey);
}
