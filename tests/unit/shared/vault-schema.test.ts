import { describe, expect, it } from 'vitest';
import {
  AliasRecordSchema,
  CredentialRecordSchema,
  PERSONAL_DATA_FIELD_DEFAULT_ACTION,
  PolicyRuleSchema,
  PrivacyLedgerEntrySchema,
  ServiceIdentityMetaSchema,
  SitePayloadSchema,
  VaultIndexSchema,
} from '../../../shared/vault-schema';

describe('VaultIndexSchema', () => {
  const minimalIndex = {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
    highTrustOrigins: [],
  };

  it('accepts an all-defaults minimal tree', () => {
    const result = VaultIndexSchema.safeParse(minimalIndex);
    expect(result.success).toBe(true);
  });

  it('rejects a tree missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = minimalIndex;
    const result = VaultIndexSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects a schemaVersion other than 1', () => {
    const result = VaultIndexSchema.safeParse({ ...minimalIndex, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  it('round-trips a serviceIdentities record keyed by origin', () => {
    const result = VaultIndexSchema.safeParse({
      ...minimalIndex,
      serviceIdentities: {
        'https://example.com': {
          origin: 'https://example.com',
          identifierB64: 'aWRlbnRpZmllcg==',
          createdAt: Date.now(),
          credentialKinds: [],
          aliasCount: 0,
          history: [],
          payloadStorageKey: 'fixture-payload-storage-key',
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('SitePayloadSchema', () => {
  it('accepts an empty payload', () => {
    const result = SitePayloadSchema.safeParse({
      origin: 'https://example.com',
      credentials: [],
      aliases: [],
    });
    expect(result.success).toBe(true);
  });

  it('round-trips nested credentials and aliases arrays', () => {
    const payload = {
      origin: 'https://example.com',
      credentials: [
        { kind: 'password', username: 'alice', password: 'hunter2' },
        { kind: 'passkey', rpId: 'example.com', credentialId: 'Y3JlZGVudGlhbA' },
      ],
      aliases: [
        {
          provider: 'none',
          providerAliasId: null,
          field: 'email',
          value: 'alice@example.com',
          note: null,
          createdAt: Date.now(),
        },
      ],
    };
    const result = SitePayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials).toHaveLength(2);
      expect(result.data.aliases).toHaveLength(1);
    }
  });

  it('rejects two credentials of the same kind for one site payload', () => {
    const result = SitePayloadSchema.safeParse({
      origin: 'https://example.com',
      credentials: [
        { kind: 'password', username: 'alice', password: 'hunter2' },
        { kind: 'password', username: 'bob', password: 'swordfish' },
      ],
      aliases: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('CredentialRecordSchema', () => {
  it('accepts a password credential', () => {
    const result = CredentialRecordSchema.safeParse({
      kind: 'password',
      username: 'alice',
      password: 'hunter2',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a password credential with a null username', () => {
    const result = CredentialRecordSchema.safeParse({
      kind: 'password',
      username: null,
      password: 'hunter2',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a passkey credential', () => {
    const result = CredentialRecordSchema.safeParse({
      kind: 'passkey',
      rpId: 'example.com',
      credentialId: 'Y3JlZGVudGlhbA',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a kind outside the union', () => {
    const result = CredentialRecordSchema.safeParse({
      kind: 'otp',
      secret: 'ABCDEF',
    });
    expect(result.success).toBe(false);
  });
});

describe('AliasRecordSchema', () => {
  it('accepts provider "none" with a null providerAliasId', () => {
    const result = AliasRecordSchema.safeParse({
      provider: 'none',
      providerAliasId: null,
      field: 'email',
      value: 'alice@example.com',
      note: null,
      createdAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a simplelogin-backed alias', () => {
    const result = AliasRecordSchema.safeParse({
      provider: 'simplelogin',
      providerAliasId: 'alias-123',
      field: 'email',
      value: 'random.alias@simplelogin.io',
      note: 'example.com',
      createdAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    const result = AliasRecordSchema.safeParse({
      provider: 'protonmail',
      providerAliasId: null,
      field: 'email',
      value: 'alice@example.com',
      note: null,
      createdAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects provider "none" with a non-null providerAliasId', () => {
    const result = AliasRecordSchema.safeParse({
      provider: 'none',
      providerAliasId: 'alias-123',
      field: 'email',
      value: 'alice@example.com',
      note: null,
      createdAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a real provider with a null providerAliasId', () => {
    const result = AliasRecordSchema.safeParse({
      provider: 'simplelogin',
      providerAliasId: null,
      field: 'email',
      value: 'random.alias@simplelogin.io',
      note: null,
      createdAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });
});

describe('ServiceIdentityMetaSchema', () => {
  it('round-trips a metadata-only entry', () => {
    const meta = {
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentialKinds: ['password', 'passkey'],
      aliasCount: 1,
      history: [{ action: 'created', at: Date.now() }],
      payloadStorageKey: 'fixture-payload-storage-key',
    };
    const result = ServiceIdentityMetaSchema.safeParse(meta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentialKinds).toHaveLength(2);
    }
  });

  it('rejects an entry missing identifierB64', () => {
    const result = ServiceIdentityMetaSchema.safeParse({
      origin: 'https://example.com',
      createdAt: Date.now(),
      credentialKinds: [],
      aliasCount: 0,
      history: [],
      payloadStorageKey: 'fixture-payload-storage-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entry missing payloadStorageKey', () => {
    const result = ServiceIdentityMetaSchema.safeParse({
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentialKinds: [],
      aliasCount: 0,
      history: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two credentialKinds entries of the same kind for one service identity', () => {
    const result = ServiceIdentityMetaSchema.safeParse({
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentialKinds: ['password', 'password'],
      aliasCount: 0,
      history: [],
      payloadStorageKey: 'fixture-payload-storage-key',
    });
    expect(result.success).toBe(false);
  });

  it('accepts one password and one passkey kind together', () => {
    const result = ServiceIdentityMetaSchema.safeParse({
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentialKinds: ['password', 'passkey'],
      aliasCount: 0,
      history: [],
      payloadStorageKey: 'fixture-payload-storage-key',
    });
    expect(result.success).toBe(true);
  });
});

describe('PolicyRuleSchema', () => {
  it('accepts a global rule', () => {
    const result = PolicyRuleSchema.safeParse({
      scope: { kind: 'global' },
      fieldType: 'phone',
      action: 'deny',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an origin-scoped rule', () => {
    const result = PolicyRuleSchema.safeParse({
      scope: { kind: 'origin', origin: 'https://shop.example' },
      fieldType: 'address',
      action: 'real',
    });
    expect(result.success).toBe(true);
  });

  it('accepts "ask" as an action, distinct from the five ResponseTypes', () => {
    const result = PolicyRuleSchema.safeParse({
      scope: { kind: 'global' },
      fieldType: 'nationalId',
      action: 'ask',
    });
    expect(result.success).toBe(true);
  });

  it("rejects a fieldType outside PersonalDataSchema's six fields", () => {
    const result = PolicyRuleSchema.safeParse({
      scope: { kind: 'global' },
      fieldType: 'username',
      action: 'deny',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an origin-scoped rule missing its origin', () => {
    const result = PolicyRuleSchema.safeParse({
      scope: { kind: 'origin' },
      fieldType: 'email',
      action: 'alias',
    });
    expect(result.success).toBe(false);
  });
});

describe('PrivacyLedgerEntrySchema', () => {
  it('round-trips a mixed disclosed/denied entry with a partial disclosedFields map', () => {
    const entry = {
      origin: 'https://example.com',
      at: Date.now(),
      requestedFields: ['email', 'phone', 'nationalId'],
      disclosedFields: { email: 'alias' as const, phone: 'real' as const },
      deniedFields: ['nationalId'],
      authorizationMethod: null,
    };
    const result = PrivacyLedgerEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it('accepts disclosedFields covering none, some, or all six fields', () => {
    expect(
      PrivacyLedgerEntrySchema.safeParse({
        origin: 'https://example.com',
        at: 1,
        requestedFields: [],
        disclosedFields: {},
        deniedFields: [],
        authorizationMethod: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a requestedFields entry outside the six known field names', () => {
    const result = PrivacyLedgerEntrySchema.safeParse({
      origin: 'https://example.com',
      at: 1,
      requestedFields: ['username'],
      disclosedFields: {},
      deniedFields: [],
      authorizationMethod: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a non-null authorizationMethod (Phase 5's eventual use)", () => {
    const result = PrivacyLedgerEntrySchema.safeParse({
      origin: 'https://example.com',
      at: 1,
      requestedFields: [],
      disclosedFields: {},
      deniedFields: [],
      authorizationMethod: 'fingerprint',
    });
    expect(result.success).toBe(true);
  });
});

describe('PERSONAL_DATA_FIELD_DEFAULT_ACTION', () => {
  it("matches privacy-model.md's own example rules exactly", () => {
    expect(PERSONAL_DATA_FIELD_DEFAULT_ACTION).toEqual({
      email: 'ask',
      name: 'ask',
      phone: 'deny',
      nationalId: 'ask',
      address: 'ask',
      birthDate: 'ask',
    });
  });
});
