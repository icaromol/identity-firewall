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
import type { AppSettings } from './settings';
import { AppSettingsSchema } from './settings';
import type {
  CredentialRecord,
  PersonalData,
  PersonalDataFieldName,
  PolicyAction,
  PolicyRule,
  PrivacyLedgerEntry,
  ResponseType,
  ServiceIdentityMeta,
} from './vault-schema';
import {
  Argon2ParamsSchema,
  CredentialRecordSchema,
  PersonalDataFieldNameSchema,
  PersonalDataSchema,
  PolicyRuleSchema,
  PolicyScopeSchema,
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

// Phase 5 M4 -- a DetectedField plus the LIVE value it held at the moment
// a form was submitted. Deliberately a separate schema from DetectedField
// rather than adding an optional `value` there -- FORM_DETECTED's fields
// are structural-only by design (Phase 1's own scope boundary: "no
// semantic classification, no required/optional trust judgment," and
// certainly no VALUES), and this is the one, narrow exception where a
// value crosses the content-script boundary at all, only ever for a
// password-bearing form's own fields, only at submit time.
export const SubmittedFieldSchema = DetectedFieldSchema.extend({
  value: z.string(),
});
export type SubmittedField = z.infer<typeof SubmittedFieldSchema>;

// Sent only for a form the content script's own cheap check found at
// least one type="password" field on (content/formDetection.ts) --
// minimization: an ordinary form's submitted values are never reported at
// all. background/firewall/loginDetector.ts re-runs its own detection
// against the structural half of these fields (value stripped) rather
// than trusting a content-script-side classification, the same
// content-extracts/background-interprets boundary FORM_DETECTED already
// keeps.
export const FormSubmittedMessageSchema = z.object({
  type: z.literal('FORM_SUBMITTED'),
  payload: z.object({
    origin: z.string(),
    formIndex: z.number(),
    fields: z.array(SubmittedFieldSchema),
  }),
});
export type FormSubmittedMessage = z.infer<typeof FormSubmittedMessageSchema>;

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

// --- Popup -> Background: Policy Engine (Phase 4) ---
export const GetPoliciesMessageSchema = z.object({
  type: z.literal('GET_POLICIES'),
  payload: z.object({}).optional(),
});
export type GetPoliciesMessage = z.infer<typeof GetPoliciesMessageSchema>;

// Upsert by (scope, fieldType) -- background/policy/storage.ts's setPolicy
// replaces any existing rule occupying that same slot rather than
// appending a duplicate.
export const SetPolicyMessageSchema = z.object({
  type: z.literal('SET_POLICY'),
  payload: PolicyRuleSchema,
});
export type SetPolicyMessage = z.infer<typeof SetPolicyMessageSchema>;

export const DeletePolicyMessageSchema = z.object({
  type: z.literal('DELETE_POLICY'),
  payload: z.object({ scope: PolicyScopeSchema, fieldType: PersonalDataFieldNameSchema }),
});
export type DeletePolicyMessage = z.infer<typeof DeletePolicyMessageSchema>;

// tabId travels in the payload for the same reason SUBMIT_FIELD_DECISIONS's
// does (see that schema's own comment) -- this message also originates in
// the popup, and the handler re-verifies the tab is still showing `origin`
// before acting, a /code-review finding: without it, a stale cached
// origin (the tab navigated away while the popup stayed open) could mark
// or unmark safe-mode for the wrong site.
export const SetHighTrustOriginMessageSchema = z.object({
  type: z.literal('SET_HIGH_TRUST_ORIGIN'),
  payload: z.object({ origin: z.string(), tabId: z.number(), isHighTrust: z.boolean() }),
});
export type SetHighTrustOriginMessage = z.infer<typeof SetHighTrustOriginMessageSchema>;

// "What does this site know about me?" (privacy-model.md) -- returns
// every PrivacyLedgerEntry recorded for one origin, most recent last
// (append-only, same order recordDisclosure writes them in).
export const GetPrivacyLedgerMessageSchema = z.object({
  type: z.literal('GET_PRIVACY_LEDGER'),
  payload: z.object({ origin: z.string() }),
});
export type GetPrivacyLedgerMessage = z.infer<typeof GetPrivacyLedgerMessageSchema>;

// Phase 6 -- the Options page's "Who knows what about me" tab, which has no
// single active-tab origin to scope by (it's a standalone page listing
// every site at once). No payload: unlike GET_PRIVACY_LEDGER, this always
// returns the whole ledger unfiltered.
export const GetAllPrivacyLedgerMessageSchema = z.object({
  type: z.literal('GET_ALL_PRIVACY_LEDGER'),
});
export type GetAllPrivacyLedgerMessage = z.infer<typeof GetAllPrivacyLedgerMessageSchema>;

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

// --- Options page -> Background: App settings (Phase 7 Part A) ---
// Deliberately separate from Personal Data/Credentials above -- see
// shared/settings.ts's own header comment on the module boundary this
// mirrors in background/settings/.
export const GetAppSettingsMessageSchema = z.object({
  type: z.literal('GET_APP_SETTINGS'),
  payload: z.object({}).optional(),
});
export type GetAppSettingsMessage = z.infer<typeof GetAppSettingsMessageSchema>;

export const SetAppSettingsMessageSchema = z.object({
  type: z.literal('SET_APP_SETTINGS'),
  // Patch-style, matching SET_PERSONAL_DATA's own convention -- a key
  // omitted from payload leaves the stored value untouched.
  payload: AppSettingsSchema.partial(),
});
export type SetAppSettingsMessage = z.infer<typeof SetAppSettingsMessageSchema>;

// A local, bounded dev-log (background/logging/) -- defined here, not in
// background/logging/storage.ts, matching every other response shape in
// this file (VaultStatusResponse, PersonalData): shared/ is the one
// direction background/ and the frontend both import FROM, never the
// reverse.
export type LogLevel = 'debug' | 'error';
export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  // Serialized to a plain string up front -- an arbitrary Error object or
  // response payload doesn't reliably round-trip through
  // browser.storage.local the way a plain string does.
  detail?: string;
}

export const GetLogsMessageSchema = z.object({
  type: z.literal('GET_LOGS'),
  payload: z.object({}).optional(),
});
export type GetLogsMessage = z.infer<typeof GetLogsMessageSchema>;

export const ClearLogsMessageSchema = z.object({
  type: z.literal('CLEAR_LOGS'),
  payload: z.object({}).optional(),
});
export type ClearLogsMessage = z.infer<typeof ClearLogsMessageSchema>;

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

// --- Popup -> Background: pending (unconfirmed) captured credential
// (Phase 5 M4) ---
// A captured login is staged here -- session state, never the encrypted
// vault -- until the user explicitly confirms via the popup. Mirrors
// Phase 3's own pending-request pattern (design decision 6,
// docs/plans/phase-5-vault-completion.md): CONFIRM writes through the
// already-existing SAVE_CREDENTIAL path; an unconfirmed capture that's
// never opened just ages out with the rest of chrome.storage.session.
export const GetPendingCredentialMessageSchema = z.object({
  type: z.literal('GET_PENDING_CREDENTIAL'),
  payload: z.object({ origin: z.string() }),
});
export type GetPendingCredentialMessage = z.infer<typeof GetPendingCredentialMessageSchema>;

// tabId travels in the payload for the same reason SUBMIT_FIELD_DECISIONS's
// does -- the handler re-verifies the tab is still showing `origin` before
// writing anything to the vault.
export const ConfirmPendingCredentialMessageSchema = z.object({
  type: z.literal('CONFIRM_PENDING_CREDENTIAL'),
  payload: z.object({ origin: z.string(), tabId: z.number() }),
});
export type ConfirmPendingCredentialMessage = z.infer<typeof ConfirmPendingCredentialMessageSchema>;

// tabId travels here too, purely so the badge can be refreshed for the
// right tab after discarding -- discarding never writes to the vault, so
// there's no origin-mismatch risk to guard against the way CONFIRM's own
// re-verification does.
// --- Popup -> Background: fill a saved credential (Phase 5 M5) ---
// Reuses AUTOFILL_FIELDS to actually write the values (background ->
// content), the exact same relay + native-setter mechanism Phase 3
// already proved for PersonalData fields -- no new content-script message
// type needed. tabId travels here for the same stale-tab re-verification
// reason SUBMIT_FIELD_DECISIONS/CONFIRM_PENDING_CREDENTIAL's own payloads
// do.
export const FillCredentialMessageSchema = z.object({
  type: z.literal('FILL_CREDENTIAL'),
  payload: z.object({ origin: z.string(), tabId: z.number(), credential: CredentialRecordSchema }),
});
export type FillCredentialMessage = z.infer<typeof FillCredentialMessageSchema>;

export const DiscardPendingCredentialMessageSchema = z.object({
  type: z.literal('DISCARD_PENDING_CREDENTIAL'),
  payload: z.object({ origin: z.string(), tabId: z.number() }),
});
export type DiscardPendingCredentialMessage = z.infer<typeof DiscardPendingCredentialMessageSchema>;

// Phase 7 Part A M4 -- credentialSaveMode: 'auto' skips the pending-
// credential prompt entirely and writes straight to the vault, so there's
// no PendingCredential left for the popup to show a "Save this login?"
// prompt for. This is the closest thing to a confirmation the popup can
// still surface: a one-time, get-and-clear flag (background/vault/
// credentials/autoSaveNotice.ts) set when an auto-save actually happens,
// consumed (and never shown again) the first time the popup asks for it.
export const TakeAutoSaveNoticeMessageSchema = z.object({
  type: z.literal('TAKE_AUTO_SAVE_NOTICE'),
  payload: z.object({ origin: z.string() }),
});
export type TakeAutoSaveNoticeMessage = z.infer<typeof TakeAutoSaveNoticeMessageSchema>;

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
  FormSubmittedMessageSchema,
  GetSessionStateMessageSchema,
  GetOriginStateMessageSchema,
  GetPendingRequestMessageSchema,
  SubmitFieldDecisionsMessageSchema,
  AutofillFieldsMessageSchema,
  GetPoliciesMessageSchema,
  SetPolicyMessageSchema,
  DeletePolicyMessageSchema,
  SetHighTrustOriginMessageSchema,
  GetPrivacyLedgerMessageSchema,
  GetAllPrivacyLedgerMessageSchema,
  VaultStatusMessageSchema,
  CreateRootIdentityMessageSchema,
  VaultUnlockMessageSchema,
  VaultLockMessageSchema,
  GetServiceIdentityMessageSchema,
  CreateServiceIdentityMessageSchema,
  GetPersonalDataMessageSchema,
  SetPersonalDataMessageSchema,
  GetAppSettingsMessageSchema,
  SetAppSettingsMessageSchema,
  GetLogsMessageSchema,
  ClearLogsMessageSchema,
  GetCredentialMessageSchema,
  SaveCredentialMessageSchema,
  DeleteCredentialMessageSchema,
  FillCredentialMessageSchema,
  GetPendingCredentialMessageSchema,
  ConfirmPendingCredentialMessageSchema,
  DiscardPendingCredentialMessageSchema,
  TakeAutoSaveNoticeMessageSchema,
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
  // Phase 4 -- the Policy Engine's resolved action per fieldType, computed
  // server-side the same way background/policy/autoApply.ts's own
  // automatic path resolves each field, so the popup can pre-fill a
  // decision without re-implementing resolvePolicy's logic itself. A
  // fieldType resolving to 'ask' here is intentionally left out of
  // decisions -- that's the whole point of "only asks what falls outside
  // the rules."
  resolvedActions: Partial<Record<PersonalDataFieldName, PolicyAction>>;
  // Phase 4 M6 -- government/financial safe mode. True when the user has
  // marked this exact origin high-trust; the popup uses this to show the
  // "safe mode" warning banner, and it's also the reason every field
  // above resolved to 'ask' regardless of any stored policy rule (see
  // resolvePolicy's own safe-mode-first ordering).
  isHighTrustOrigin: boolean;
}
// Never null (a /code-review finding fixed this): isHighTrustOrigin is a
// persistent per-origin setting the popup needs even when no form has
// been detected this session, so handleGetPendingRequest always returns a
// full PendingRequest with forms: [] rather than short-circuiting.
export type GetPendingRequestResponse = PendingRequest;

// SUBMIT_FIELD_DECISIONS's response payload shape (background/firewall/
// handler.ts's handleSubmitFieldDecisions) -- resolvedValues mirrors
// AUTOFILL_FIELDS's own `values` shape so the popup can show what was
// actually filled without a second round trip, even though the real
// write-back happens in the content script via the relayed AUTOFILL_FIELDS
// message, not via this response directly.
export interface SubmitFieldDecisionsResponse {
  resolvedValues: Record<string, string>;
}

// SET_POLICY/DELETE_POLICY's response payload shape (background/policy/
// handler.ts) -- both return the full, current policies array rather than
// just the one rule touched, so the caller never needs a second round
// trip to refresh its own list after a write.
export type SetPolicyResponse = PolicyRule[];
export type DeletePolicyResponse = PolicyRule[];

// GET_POLICIES's response shape -- Phase 7 Part A M5 adds
// availableResponses alongside the plain policies array PendingRequest's
// own shape (above) already established this exact convention for: which
// ResponseType choices are actually offerable per field is computed
// server-side (background has PersonalData and aliasProviderConfig; the
// Dashboard has neither) using the same responseAvailability.ts logic
// SUBMIT_FIELD_DECISIONS re-validates against -- one source of truth for
// "what's allowed," not a second client-side copy that could drift.
// Unlike PendingRequest's version (keyed only by fieldTypes actually
// present in a form), this covers all six PersonalDataFieldName keys
// unconditionally, since the Personal Data tab's per-field default-policy
// dropdowns aren't scoped to any one page's forms.
export interface GetPoliciesResponse {
  policies: PolicyRule[];
  availableResponses: Record<PersonalDataFieldName, ResponseType[]>;
}

// SET_HIGH_TRUST_ORIGIN's response payload shape -- the full, current
// list, same "avoid a second round trip" convention as the policy
// responses above.
export type SetHighTrustOriginResponse = string[];

// GET_PRIVACY_LEDGER's response payload shape (background/policy/handler.ts).
export type GetPrivacyLedgerResponse = PrivacyLedgerEntry[];

// GET_ALL_PRIVACY_LEDGER's response payload shape -- every entry across
// every origin, unfiltered; the store on the receiving end groups these by
// entry.origin itself (stores/allSitesLedger.store.ts).
export type GetAllPrivacyLedgerResponse = PrivacyLedgerEntry[];

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

// GET_APP_SETTINGS/SET_APP_SETTINGS's response payload shapes
// (background/settings/handler.ts).
export type GetAppSettingsResponse = AppSettings;
export type SetAppSettingsResponse = AppSettings;
export type GetLogsResponse = LogEntry[];
export type ClearLogsResponse = undefined;
export type GetCredentialResponse = CredentialRecord[];
export type SaveCredentialResponse = CredentialRecord;
export type DeleteCredentialResponse = undefined;

// GET_PENDING_CREDENTIAL/CONFIRM_PENDING_CREDENTIAL/
// DISCARD_PENDING_CREDENTIAL's response payload shapes
// (background/vault/credentials/handler.ts, M4). null when nothing is
// staged for that origin, matching GET_ORIGIN_STATE's own
// null-when-absent convention. CONFIRM's response is the just-saved
// CredentialRecord (SAVE_CREDENTIAL's own response shape) -- the popup
// never needs a second round trip to see what was actually persisted.
export interface PendingCredential {
  identifier: string | null;
  password: string;
  capturedAt: number;
}
export type GetPendingCredentialResponse = PendingCredential | null;

// FILL_CREDENTIAL's response payload shape -- false when the current page
// has no password-bearing form to fill into at all (a stale/closed tab,
// or a page that navigated away from any form since it was last
// detected), true once AUTOFILL_FIELDS was actually relayed.
export interface FillCredentialResponse {
  filled: boolean;
}
export type ConfirmPendingCredentialResponse = CredentialRecord;
export type DiscardPendingCredentialResponse = undefined;
export type TakeAutoSaveNoticeResponse = boolean;

// EXPORT_VAULT_BACKUP/RESTORE_VAULT_BACKUP's response payload shapes
// (background/vault/handler.ts), same direct-alias convention as above (M7).
export type ExportVaultBackupResponse = VaultBackupBundle;
export type RestoreVaultBackupResponse = Record<string, never>;
