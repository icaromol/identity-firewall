// Message contract. Every message crossing content script / background /
// popup boundaries is validated with Zod, not just typed -- see
// docs/browser-architecture.md's tech-stack table. A message that fails
// validation is rejected at the router boundary (background/router/
// dispatch.ts, M3), before any handler runs.
//
// Phase 1 shipped three types (FORM_DETECTED, GET_SESSION_STATE,
// GET_ORIGIN_STATE). Phase 2 (M1) adds the 13 vault/identity message
// types below, additively, to the same discriminated union -- see
// docs/plans/phase-2-local-identity-vault.md. CLASSIFY_FIELDS,
// POLICY_DECISION, etc. still belong to Phase 3/4 and aren't here yet.

import { z } from 'zod';
import { Argon2ParamsSchema, CredentialRecordSchema, PersonalDataSchema } from './vault-schema';

export const DetectedFieldSchema = z.object({
  tagName: z.enum(['input', 'textarea', 'select']),
  type: z.string().nullable(), // input.type; null for textarea/select
  name: z.string().nullable(),
  id: z.string().nullable(),
  required: z.boolean(),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const DetectedFormSchema = z.object({
  formIndex: z.number(), // position within document.forms
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(DetectedFieldSchema),
});
export type DetectedForm = z.infer<typeof DetectedFormSchema>;

// --- Content script -> Background ---
export const FormDetectedMessageSchema = z.object({
  type: z.literal('FORM_DETECTED'),
  payload: z.object({
    origin: z.string(), // canonical origin, see shared/origin.ts
    url: z.string(),
    detectedAt: z.number(), // epoch ms
    forms: z.array(DetectedFormSchema),
  }),
});
export type FormDetectedMessage = z.infer<typeof FormDetectedMessageSchema>;

// --- Popup -> Background ---
export const GetSessionStateMessageSchema = z.object({
  type: z.literal('GET_SESSION_STATE'),
  payload: z.object({}).optional(),
});
export type GetSessionStateMessage = z.infer<typeof GetSessionStateMessageSchema>;

export const GetOriginStateMessageSchema = z.object({
  type: z.literal('GET_ORIGIN_STATE'),
  payload: z.object({ origin: z.string() }),
});
export type GetOriginStateMessage = z.infer<typeof GetOriginStateMessageSchema>;

// --- Popup -> Background: vault unlock (shared by CREATE_ROOT_IDENTITY
// and VAULT_UNLOCK -- setting up the vault and unlocking it later both
// need to prove the same thing, "I hold the unlock factor," per
// docs/plans/phase-2-local-identity-vault.md's M4 section) ---
export const UnlockInputSchema = z.discriminatedUnion('unlockMethod', [
  z.object({
    unlockMethod: z.literal('passkey'),
    prfOutputB64: z.string(),
    credentialId: z.string(),
    rpId: z.string(),
  }),
  z.object({
    unlockMethod: z.literal('passphrase'),
    passphrase: z.string(),
  }),
]);
export type UnlockInput = z.infer<typeof UnlockInputSchema>;

// --- Popup -> Background: vault lifecycle ---
export const VaultStatusMessageSchema = z.object({
  type: z.literal('VAULT_STATUS'),
  payload: z.object({}).optional(),
});
export type VaultStatusMessage = z.infer<typeof VaultStatusMessageSchema>;

export const CreateRootIdentityMessageSchema = z.object({
  type: z.literal('CREATE_ROOT_IDENTITY'),
  payload: UnlockInputSchema,
});
export type CreateRootIdentityMessage = z.infer<typeof CreateRootIdentityMessageSchema>;

export const VaultUnlockMessageSchema = z.object({
  type: z.literal('VAULT_UNLOCK'),
  payload: UnlockInputSchema,
});
export type VaultUnlockMessage = z.infer<typeof VaultUnlockMessageSchema>;

export const VaultLockMessageSchema = z.object({
  type: z.literal('VAULT_LOCK'),
  payload: z.object({}).optional(),
});
export type VaultLockMessage = z.infer<typeof VaultLockMessageSchema>;

// --- Popup -> Background: Service Identity ---
export const GetServiceIdentityMessageSchema = z.object({
  type: z.literal('GET_SERVICE_IDENTITY'),
  payload: z.object({ origin: z.string() }),
});
export type GetServiceIdentityMessage = z.infer<typeof GetServiceIdentityMessageSchema>;

export const CreateServiceIdentityMessageSchema = z.object({
  type: z.literal('CREATE_SERVICE_IDENTITY'),
  payload: z.object({ origin: z.string() }),
});
export type CreateServiceIdentityMessage = z.infer<typeof CreateServiceIdentityMessageSchema>;

// --- Popup -> Background: Personal Data ---
export const GetPersonalDataMessageSchema = z.object({
  type: z.literal('GET_PERSONAL_DATA'),
  payload: z.object({}).optional(),
});
export type GetPersonalDataMessage = z.infer<typeof GetPersonalDataMessageSchema>;

export const SetPersonalDataMessageSchema = z.object({
  type: z.literal('SET_PERSONAL_DATA'),
  // Patch-style update, not a full overwrite -- no .partial() needed since
  // every PersonalDataSchema field is already .optional().
  payload: PersonalDataSchema,
});
export type SetPersonalDataMessage = z.infer<typeof SetPersonalDataMessageSchema>;

// --- Popup -> Background: Credentials ---
export const GetCredentialMessageSchema = z.object({
  type: z.literal('GET_CREDENTIAL'),
  payload: z.object({ origin: z.string() }),
});
export type GetCredentialMessage = z.infer<typeof GetCredentialMessageSchema>;

export const SaveCredentialMessageSchema = z.object({
  type: z.literal('SAVE_CREDENTIAL'),
  payload: z.object({ origin: z.string(), credential: CredentialRecordSchema }),
});
export type SaveCredentialMessage = z.infer<typeof SaveCredentialMessageSchema>;

export const DeleteCredentialMessageSchema = z.object({
  type: z.literal('DELETE_CREDENTIAL'),
  payload: z.object({ origin: z.string(), kind: z.enum(['password', 'passkey']) }),
});
export type DeleteCredentialMessage = z.infer<typeof DeleteCredentialMessageSchema>;

// --- Popup -> Background: secure export / local backup ---
// Argon2ParamsSchema itself lives in vault-schema.ts (M2) -- also read/
// written unencrypted via background/vault/storage.ts's
// getPassphraseArgon2Params/setPassphraseArgon2Params (M3), not just this
// backup bundle.

export const VaultBackupBundleSchema = z.object({
  formatVersion: z.literal(1),
  kdf: z.literal('argon2id'),
  kdfParams: Argon2ParamsSchema,
  argon2SaltB64: z.string(),
  ivB64: z.string(),
  ciphertextB64: z.string(),
});
export type VaultBackupBundle = z.infer<typeof VaultBackupBundleSchema>;

export const ExportVaultBackupMessageSchema = z.object({
  type: z.literal('EXPORT_VAULT_BACKUP'),
  payload: z.object({ backupPassphrase: z.string() }),
});
export type ExportVaultBackupMessage = z.infer<typeof ExportVaultBackupMessageSchema>;

export const RestoreVaultBackupMessageSchema = z.object({
  type: z.literal('RESTORE_VAULT_BACKUP'),
  payload: z.object({
    bundle: VaultBackupBundleSchema,
    backupPassphrase: z.string(),
    newUnlockInput: UnlockInputSchema,
  }),
});
export type RestoreVaultBackupMessage = z.infer<typeof RestoreVaultBackupMessageSchema>;

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  FormDetectedMessageSchema,
  GetSessionStateMessageSchema,
  GetOriginStateMessageSchema,
  VaultStatusMessageSchema,
  CreateRootIdentityMessageSchema,
  VaultUnlockMessageSchema,
  VaultLockMessageSchema,
  GetServiceIdentityMessageSchema,
  CreateServiceIdentityMessageSchema,
  GetPersonalDataMessageSchema,
  SetPersonalDataMessageSchema,
  GetCredentialMessageSchema,
  SaveCredentialMessageSchema,
  DeleteCredentialMessageSchema,
  ExportVaultBackupMessageSchema,
  RestoreVaultBackupMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

// --- Reply envelope: every handler resolves to exactly one of these ---
export type MessageResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// GET_SESSION_STATE's response payload shape (background/session/handler.ts's
// handleGetSessionState). Named once and imported by both the handler and
// stores/session.store.ts, rather than each declaring its own copy -- the
// message channel itself is untyped JSON, but within this single-package
// TypeScript program a rename here still forces both sides to be updated
// together at compile time.
export interface OriginSummary {
  origin: string;
  formCount: number;
  lastDetectedAt: number;
}
