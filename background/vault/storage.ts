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
  type VaultData,
  VaultDataSchema,
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
