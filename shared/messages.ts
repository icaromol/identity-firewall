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
import type {
  CredentialRecord,
  PersonalData,
  PersonalDataFieldName,
  ResponseType,
  ServiceIdentityMeta,
} from './vault-schema';
import {
  Argon2ParamsSchema,
  CredentialRecordSchema,
  PersonalDataFieldNameSchema,
  PersonalDataSchema,
  ResponseTypeSchema,
  SensitivityLevelSchema,
} from './vault-schema';

export const DetectedFieldSchema = z.object({
  tagName: z.enum(['input', 'textarea', 'select']),
  type: z.string().nullable(), // input.type; null for textarea/select
  name: z.string().nullable(),
  id: z.string().nullable(),
  required: z.boolean(),
  // Raw autocomplete attribute (e.g. 'email', 'tel', 'bday') -- still
  // structural extraction, not semantic judgment: it's a literal HTML
  // attribute, same category as type/name/id. Phase 3's Field Classifier
  // (background/firewall/classifier.ts) is what actually interprets it.
  autocomplete: z.string().nullable(),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const DetectedFormSchema = z.object({
  formIndex: z.number(), // position within document.forms
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(DetectedFieldSchema),
});
export type DetectedForm = z.infer<typeof DetectedFormSchema>;

// background/firewall/classifier.ts's output shape (Phase 3) -- lives here,
// not in that background module, so the message contract (GET_PENDING_REQUEST
// below) can reference it without background/ importing into shared/ or
// vice versa, matching how DetectedField/DetectedForm above already work.
export const ClassifiedFieldSchema = DetectedFieldSchema.extend({
  fieldType: PersonalDataFieldNameSchema.nullable(),
  sensitivity: SensitivityLevelSchema.nullable(),
  apparentlyRequired: z.boolean(),
});
export type ClassifiedField = z.infer<typeof ClassifiedFieldSchema>;

export const ClassifiedFormSchema = z.object({
  formIndex: z.number(),
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(ClassifiedFieldSchema),
});
export type ClassifiedForm = z.infer<typeof ClassifiedFormSchema>;

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

// --- Popup -> Background: Identity Firewall (Phase 3) ---
// Deliberately a separate message type from GET_ORIGIN_STATE above rather
// than overloading it -- GET_ORIGIN_STATE serves the lightweight "sites
// visited this session" list, this serves the approval UI's full
// classified-field view, a different purpose with a much richer response.
export const GetPendingRequestMessageSchema = z.object({
  type: z.literal('GET_PENDING_REQUEST'),
  payload: z.object({ origin: z.string() }),
});
export type GetPendingRequestMessage = z.infer<typeof GetPendingRequestMessageSchema>;

// tabId travels explicitly in the payload, not read off the sender --
// this message originates in the POPUP (an extension page with no tab of
// its own), not a content script, so HandlerContext.sender.tab would be
// undefined. The popup captures the active tab's id itself (the same
// browser.tabs.query() call it already needs for GET_PENDING_REQUEST's
// origin) and passes it through so the handler knows which tab's content
// script to relay AUTOFILL_FIELDS to.
export const SubmitFieldDecisionsMessageSchema = z.object({
  type: z.literal('SUBMIT_FIELD_DECISIONS'),
  payload: z.object({
    origin: z.string(),
    tabId: z.number(),
    formIndex: z.number(),
    decisions: z.record(z.string(), ResponseTypeSchema), // keyed by shared/fieldKey.ts's getFieldKey
  }),
});
export type SubmitFieldDecisionsMessage = z.infer<typeof SubmitFieldDecisionsMessageSchema>;

// --- Background -> Content script (Phase 3 M5) ---
// Sent via browser.tabs.sendMessage(tabId, ...), never through
// background/router/dispatch.ts's own browser.runtime.onMessage listener
// (that listener only ever receives content-script/popup -> background
// traffic) -- entrypoints/content.ts validates and handles this itself.
// Only fields that resolved to a non-null value are present here -- a
// Deny decision is simply absent, not included with a null/empty value.
export const AutofillFieldsMessageSchema = z.object({
  type: z.literal('AUTOFILL_FIELDS'),
  payload: z.object({
    formIndex: z.number(),
    values: z.record(z.string(), z.string()), // keyed by shared/fieldKey.ts's getFieldKey
  }),
});
export type AutofillFieldsMessage = z.infer<typeof AutofillFieldsMessageSchema>;

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
  GetPendingRequestMessageSchema,
  SubmitFieldDecisionsMessageSchema,
  AutofillFieldsMessageSchema,
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

// GET_PENDING_REQUEST's response payload shape (background/firewall/
// handler.ts's handleGetPendingRequest) -- null when nothing has been
// detected for that origin this session, matching GET_ORIGIN_STATE's own
// null-when-absent convention above.
//
// availableResponses is computed server-side (background has PersonalData
// and aliasProviderConfig; the popup has neither) using the exact same
// responseAvailability.ts logic handleSubmitFieldDecisions re-validates
// against later -- one source of truth for "what's allowed," not a second
// client-side copy that could drift. Keyed by fieldType, not per-field,
// since two fields sharing a fieldType always share the same availability.
export interface PendingRequest {
  forms: ClassifiedForm[];
  availableResponses: Partial<Record<PersonalDataFieldName, ResponseType[]>>;
}
export type GetPendingRequestResponse = PendingRequest | null;

// SUBMIT_FIELD_DECISIONS's response payload shape (background/firewall/
// handler.ts's handleSubmitFieldDecisions) -- resolvedValues mirrors
// AUTOFILL_FIELDS's own `values` shape so the popup can show what was
// actually filled without a second round trip, even though the real
// write-back happens in the content script via the relayed AUTOFILL_FIELDS
// message, not via this response directly.
export interface SubmitFieldDecisionsResponse {
  resolvedValues: Record<string, string>;
}

// VAULT_STATUS's response payload shape (background/vault/handler.ts's
// handleVaultStatus), named once for the same reason as OriginSummary above.
// configuredUnlockMethod/passkeyCredentialId are undefined until a vault has
// been set up (or, for passkeyCredentialId, unless the configured method is
// 'passkey') -- the popup treats an undefined configuredUnlockMethod as
// "show both unlock forms" rather than an error (M4).
export interface VaultStatusResponse {
  initialized: boolean;
  locked: boolean;
  configuredUnlockMethod: 'passkey' | 'passphrase' | undefined;
  passkeyCredentialId: string | undefined;
}

// GET_SERVICE_IDENTITY/CREATE_SERVICE_IDENTITY's response payload shapes
// (background/identity/handler.ts) reuse ServiceIdentityMeta directly
// rather than inventing a trimmed response type the way OriginSummary/
// VaultStatusResponse were invented. Repointed from the old
// ServiceIdentityRecord (which nested real credential/alias VALUES) to
// ServiceIdentityMeta (index-tier metadata only) by the vault storage
// tiering refactor's Step 5, per ADR-015 -- M7's original acceptance
// criterion ("the exact same keypair" survives a backup restore) still
// holds, just verified via identifierB64 specifically now rather than "the
// exact same record," since a record's nested credentials/aliases no
// longer exist on this type at all.
export type GetServiceIdentityResponse = ServiceIdentityMeta | null;
export type CreateServiceIdentityResponse = ServiceIdentityMeta;

// GET_PERSONAL_DATA/SET_PERSONAL_DATA and GET_CREDENTIAL/SAVE_CREDENTIAL/
// DELETE_CREDENTIAL's response payload shapes (background/vault/
// personalData/handler.ts, background/vault/credentials/handler.ts), same
// direct-alias convention as GetServiceIdentityResponse above (M6).
// GetCredentialResponse is an array, not a single record -- GET_CREDENTIAL's
// payload carries no `kind`, so it can only mean "every credential stored
// for this origin" (0-2 entries, per the at-most-one-per-kind constraint on
// ServiceIdentityRecordSchema.credentials).
export type GetPersonalDataResponse = PersonalData;
export type SetPersonalDataResponse = PersonalData;
export type GetCredentialResponse = CredentialRecord[];
export type SaveCredentialResponse = CredentialRecord;
export type DeleteCredentialResponse = undefined;

// EXPORT_VAULT_BACKUP/RESTORE_VAULT_BACKUP's response payload shapes
// (background/vault/handler.ts), same direct-alias convention as above (M7).
export type ExportVaultBackupResponse = VaultBackupBundle;
export type RestoreVaultBackupResponse = Record<string, never>;
