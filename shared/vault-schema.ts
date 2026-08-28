// Zod schemas for the vault's full data tree (docs/data-model.md). Schema,
// storage, and encryption for these trees is Phase 2's job; the *behavior*
// that reads/writes Policies and PrivacyLedger meaningfully is Phase 4's,
// and Aliases provider integration is Phase 6's -- see
// docs/plans/phase-2-local-identity-vault.md's scope boundary table.
//
// Credentials and Aliases are nested per-ServiceIdentity, not top-level
// VaultData fields, despite data-model.md's own ASCII tree suggesting
// otherwise -- both that doc's own prose bullet and identity-model.md are
// explicit that each Service Identity "holds... credentials, aliases...".
// The tree diagram is conceptual, not a literal storage layout.

import { z } from 'zod';

// --- Sensitivity classification (data-model.md) ---
export const SensitivityLevelSchema = z.enum(['public', 'private', 'sensitive', 'highlySensitive']);
export type SensitivityLevel = z.infer<typeof SensitivityLevelSchema>;

// --- Response types per field (data-model.md) ---
export const ResponseTypeSchema = z.enum(['real', 'alias', 'synthetic', 'nonsense', 'deny']);
export type ResponseType = z.infer<typeof ResponseTypeSchema>;

// --- Argon2id parameters (ADR-012) ---
// Lives here, not shared/messages.ts, so RootIdentitySchema below can
// reference it without messages.ts's schemas creating a circular import
// (messages.ts already imports several schemas FROM this file).
//
// Upper bounds matter here, not just lower ones: this schema validates
// VaultBackupBundle.kdfParams (shared/messages.ts) at RESTORE_VAULT_BACKUP's
// untrusted-input boundary. Without a ceiling, a corrupted or malicious
// backup file's kdfParams could force an effectively unbounded Argon2id
// computation (@noble/hashes's own maxmem default caps runaway `m`, but
// nothing caps `t` or `p`) instead of failing validation fast. Bounds below
// are generous relative to DEFAULT_ARGON2_PARAMS (t=2, m=19456, p=1) while
// still ruling out a pathological value.
export const Argon2ParamsSchema = z.object({
  t: z.number().int().positive().max(10), // iterations
  m: z.number().int().positive().max(1_048_576), // memory, KiB (<= 1 GiB)
  p: z.number().int().positive().max(16), // parallelism
});
export type Argon2Params = z.infer<typeof Argon2ParamsSchema>;

// --- RootIdentity ---
// rootSecretB64 is the HKDF ikm for every Service Identity derivation
// (ADR-010) -- generated once at setup (M4), encrypted at rest as part of
// the whole vault blob. FixedAppSalt, VaultUnlockKey, and
// passphraseArgon2Params are deliberately NOT part of this schema --
// FixedAppSalt lives unencrypted in browser.storage.local (HKDF salts
// aren't secret), VaultUnlockKey is never persisted anywhere, session-cached
// only (see docs/plans/phase-2-local-identity-vault.md's three-key
// hierarchy), and passphraseArgon2Params (ADR-012) also lives unencrypted in
// browser.storage.local -- background/vault/storage.ts's
// getPassphraseArgon2Params/setPassphraseArgon2Params -- specifically
// because the passphrase-unlock derivation needs to read it BEFORE it can
// derive the key that decrypts this very blob; putting it inside the
// encrypted tree (M2's original placement) was a chicken-and-egg bug caught
// during M3.
export const RootIdentitySchema = z.object({
  rootSecretB64: z.string(),
  createdAt: z.number(), // epoch ms
});
export type RootIdentity = z.infer<typeof RootIdentitySchema>;

// --- PersonalData (data-model.md's exact field list) ---
// All fields optional: a freshly-created vault has none filled in yet --
// this is "the key itself might not be sent" (established .optional()
// convention from shared/messages.ts), not "the key exists but is empty."
export const PersonalDataSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  nationalId: z.string().optional(), // CPF or local equivalent
  address: z.string().optional(),
  birthDate: z.string().optional(), // ISO 8601 date
});
export type PersonalData = z.infer<typeof PersonalDataSchema>;

// A static field->sensitivity map mirroring data-model.md's own table --
// data, not Policy Engine behavior (that stays Phase 4's), so it belongs
// here alongside the schema it classifies.
export const PERSONAL_DATA_FIELD_SENSITIVITY: Record<keyof PersonalData, SensitivityLevel> = {
  name: 'sensitive',
  email: 'private',
  phone: 'sensitive',
  nationalId: 'highlySensitive',
  address: 'sensitive',
  birthDate: 'sensitive',
};

// --- Credentials ---
// Password: a real secret, protected only by whole-blob AES-GCM -- no
// field-level encryption, matching Attestto's own validated choice
// (research/attestto-teardown.md §1).
export const PasswordCredentialSchema = z.object({
  kind: z.literal('password'),
  username: z.string().nullable(),
  password: z.string(),
});
export type PasswordCredential = z.infer<typeof PasswordCredentialSchema>;

// Passkey: a REFERENCE only, per ADR-011's metadata-only WebAuthn mode --
// never private key material. The private key lives in the OS/hardware
// authenticator, never in this vault.
export const PasskeyCredentialSchema = z.object({
  kind: z.literal('passkey'),
  rpId: z.string(),
  credentialId: z.string(), // base64url, per WebAuthn convention
});
export type PasskeyCredential = z.infer<typeof PasskeyCredentialSchema>;

export const CredentialRecordSchema = z.discriminatedUnion('kind', [
  PasswordCredentialSchema,
  PasskeyCredentialSchema,
]);
export type CredentialRecord = z.infer<typeof CredentialRecordSchema>;

// Bare credential kind, without the rest of a full CredentialRecord --
// needed by ServiceIdentityMetaSchema below (ADR-015's index tier) to
// record WHICH kinds exist for an origin without ever storing their values.
export const CredentialKindSchema = z.enum(['password', 'passkey']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

// --- Aliases ---
export const AliasProviderNameSchema = z.enum(['none', 'simplelogin', 'addy']);
export type AliasProviderName = z.infer<typeof AliasProviderNameSchema>;

// provider/providerAliasId/value/note are named explicitly in
// data-model.md's prose; `field` and `createdAt` come from
// research/email-alias-integration.md's own pseudocode sketch (needed to
// round-trip what real alias-provider APIs actually return) -- not
// literally enumerated in data-model.md's prose, added here deliberately.
export const AliasRecordSchema = z
  .object({
    provider: AliasProviderNameSchema,
    providerAliasId: z.string().nullable(), // null when provider is 'none'
    field: z.string(), // which field this alias substitutes, e.g. 'email'
    value: z.string(),
    note: z.string().nullable(), // SimpleLogin's `hostname` / addy.io's `description`
    createdAt: z.number(),
  })
  // Enforces the invariant the field comment above already documents:
  // providerAliasId is null exactly when there's no real provider behind
  // this alias, never independently of it.
  .refine((record) => (record.provider === 'none') === (record.providerAliasId === null), {
    message: "providerAliasId must be null if and only if provider is 'none'",
  });
export type AliasRecord = z.infer<typeof AliasRecordSchema>;

// Schema-only in Phase 2: defaults to 'none', no outbound network calls --
// Phase 6 wires the actual provider API integration.
export const AliasProviderConfigSchema = z.object({
  provider: AliasProviderNameSchema.default('none'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(), // supports a self-hosted instance
});
export type AliasProviderConfig = z.infer<typeof AliasProviderConfigSchema>;

// --- ServiceIdentities ---
export const ServiceIdentityHistoryEntrySchema = z.object({
  action: z.string(), // e.g. 'created', 'credential_added', 'accessed'
  at: z.number(),
});
export type ServiceIdentityHistoryEntry = z.infer<typeof ServiceIdentityHistoryEntrySchema>;

// @deprecated Superseded by ServiceIdentityMetaSchema (ADR-015's index
// tier, below) + SitePayloadSchema (ADR-015's per-site payload tier, near
// VaultIndexSchema below) -- this single-record shape nests real
// credential/alias VALUES inline, exactly what the vault storage tiering
// refactor (docs/plans/phase-2-vault-tiering-refactor.md) moves out of the
// always-decrypted index. Kept until that plan's Step 6 migrates its last
// consumer, then deleted.
export const ServiceIdentityRecordSchema = z.object({
  origin: z.string(), // CanonicalOrigin (shared/origin.ts) as a plain string -- the branded type is TS-only, not preserved through JSON storage
  identifierB64: z.string(), // the derived Ed25519 public key for this origin (ADR-010, built in M5)
  createdAt: z.number(),
  // At most one credential per `kind` -- DELETE_CREDENTIAL (shared/messages.ts)
  // identifies which credential to remove by { origin, kind } alone, which
  // is only unambiguous under this constraint.
  credentials: z
    .array(CredentialRecordSchema)
    .refine((credentials) => new Set(credentials.map((c) => c.kind)).size === credentials.length, {
      message: 'at most one credential per kind is allowed per service identity',
    }),
  aliases: z.array(AliasRecordSchema),
  history: z.array(ServiceIdentityHistoryEntrySchema),
});
export type ServiceIdentityRecord = z.infer<typeof ServiceIdentityRecordSchema>;

// --- ServiceIdentityMeta (Tier 1 index entry, ADR-015) ---
// Metadata-only per-origin view: enough to answer "which sites do I have
// an account for" and "what kind of credential does this site have" without
// ever decrypting that site's actual secret values (Tier 3, SitePayloadSchema
// near VaultIndexSchema below).
export const ServiceIdentityMetaSchema = z.object({
  origin: z.string(), // CanonicalOrigin as a plain string, same convention as ServiceIdentityRecordSchema.origin above
  identifierB64: z.string(), // the derived Ed25519 public key for this origin (ADR-010)
  createdAt: z.number(),
  // Which credential KINDS exist, not their values -- the whole point of
  // the index tier is answering "does this site have a password/passkey"
  // without ever decrypting that site's actual secret values.
  credentialKinds: z
    .array(CredentialKindSchema)
    .refine((kinds) => new Set(kinds).size === kinds.length, {
      message: 'at most one credential per kind is allowed per service identity',
    }),
  aliasCount: z.number().int().nonnegative(),
  history: z.array(ServiceIdentityHistoryEntrySchema),
  // Random (a UUID), never derived from `origin` -- a deterministic name,
  // even hashed, would let an attacker with mere read access to
  // browser.storage.local (no decryption needed) enumerate candidate
  // origins against the naming scheme and recover the site list from key
  // NAMES alone, defeating the index's entire purpose (ADR-015's first
  // supporting rule).
  payloadStorageKey: z.string(),
});
export type ServiceIdentityMeta = z.infer<typeof ServiceIdentityMetaSchema>;

// --- Policies / PrivacyLedger ---
// Schema-only in Phase 2 -- Phase 4 owns the engine that reads/writes
// these meaningfully (docs/plans/phase-2-local-identity-vault.md's scope
// boundary table).
export const PolicyRuleSchema = z.object({
  fieldSensitivity: SensitivityLevelSchema,
  defaultResponse: ResponseTypeSchema,
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PrivacyLedgerEntrySchema = z.object({
  origin: z.string(),
  at: z.number(),
  requestedFields: z.array(z.string()),
  disclosedFields: z.array(z.string()),
  deniedFields: z.array(z.string()),
});
export type PrivacyLedgerEntry = z.infer<typeof PrivacyLedgerEntrySchema>;

// --- The whole vault (deprecated, ADR-015) ---
// @deprecated Superseded by the three-tier split below: VaultIndexSchema
// (RootIdentity + per-origin metadata only), PersonalDataSchema in its own
// top-level storage key (unchanged shape, new home), and SitePayloadSchema
// per origin (real credential/alias values). See
// docs/adr/ADR-015-three-tier-vault-storage.md. Kept until
// docs/plans/phase-2-vault-tiering-refactor.md's Step 6 migrates its last
// consumer (background/vault/storage.ts's whole-blob read/write functions),
// then deleted.
export const VaultDataSchema = z.object({
  schemaVersion: z.literal(1),
  rootIdentity: RootIdentitySchema,
  personalData: PersonalDataSchema,
  serviceIdentities: z.record(z.string(), ServiceIdentityRecordSchema), // keyed by CanonicalOrigin
  aliasProviderConfig: AliasProviderConfigSchema,
  policies: z.array(PolicyRuleSchema),
  privacyLedger: z.array(PrivacyLedgerEntrySchema),
});
export type VaultData = z.infer<typeof VaultDataSchema>;

// --- Vault Index (Tier 1, ADR-015) ---
// Decrypted on every unlock -- RootIdentity plus per-origin METADATA ONLY
// (ServiceIdentityMetaSchema above), no credential/alias VALUES and no
// PersonalData (that's its own tier, Tier 2, stored under a completely
// separate key -- see the "Storage-key naming" table in
// docs/plans/phase-2-vault-tiering-refactor.md).
export const VaultIndexSchema = z.object({
  schemaVersion: z.literal(1),
  rootIdentity: RootIdentitySchema,
  serviceIdentities: z.record(z.string(), ServiceIdentityMetaSchema), // keyed by CanonicalOrigin
  aliasProviderConfig: AliasProviderConfigSchema,
  policies: z.array(PolicyRuleSchema),
  privacyLedger: z.array(PrivacyLedgerEntrySchema),
});
export type VaultIndex = z.infer<typeof VaultIndexSchema>;

// --- Site Payload (Tier 3, ADR-015) ---
// One per origin, stored under browser.storage.local key
// `if_vault_site_<payloadStorageKey>_v1` (never keyed by origin itself --
// see ServiceIdentityMetaSchema.payloadStorageKey's own comment above),
// encrypted with a key derived on demand (background/vault/siteKey.ts).
// Holds the real credential/alias VALUES the index above only summarizes.
export const SitePayloadSchema = z.object({
  origin: z.string(), // redundant with the index entry -- lets a standalone decrypt sanity-check it landed on the RIGHT site's blob, not a misrouted one
  credentials: z
    .array(CredentialRecordSchema)
    .refine((credentials) => new Set(credentials.map((c) => c.kind)).size === credentials.length, {
      message: 'at most one credential per kind is allowed per service identity',
    }),
  aliases: z.array(AliasRecordSchema),
});
export type SitePayload = z.infer<typeof SitePayloadSchema>;
