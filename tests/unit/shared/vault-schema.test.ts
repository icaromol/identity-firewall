import { describe, expect, it } from 'vitest';
import {
  AliasRecordSchema,
  CredentialRecordSchema,
  RootIdentitySchema,
  ServiceIdentityRecordSchema,
  VaultDataSchema,
} from '../../../shared/vault-schema';

describe('VaultDataSchema', () => {
  const minimalVault = {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    personalData: {},
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
  };

  it('accepts an all-defaults minimal tree', () => {
    const result = VaultDataSchema.safeParse(minimalVault);
    expect(result.success).toBe(true);
  });

  it('rejects a tree missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = minimalVault;
    const result = VaultDataSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('rejects a schemaVersion other than 1', () => {
    const result = VaultDataSchema.safeParse({ ...minimalVault, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  it('round-trips a serviceIdentities record keyed by origin', () => {
    const result = VaultDataSchema.safeParse({
      ...minimalVault,
      serviceIdentities: {
        'https://example.com': {
          origin: 'https://example.com',
          identifierB64: 'aWRlbnRpZmllcg==',
          createdAt: Date.now(),
          credentials: [],
          aliases: [],
          history: [],
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('RootIdentitySchema', () => {
  it('accepts a tree without passphraseArgon2Params (passkey-only unlock)', () => {
    const result = RootIdentitySchema.safeParse({
      rootSecretB64: 'c2VjcmV0',
      createdAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a tree with passphraseArgon2Params (passphrase unlock configured)', () => {
    const result = RootIdentitySchema.safeParse({
      rootSecretB64: 'c2VjcmV0',
      createdAt: Date.now(),
      passphraseArgon2Params: { t: 2, m: 19456, p: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects passphraseArgon2Params with a non-positive field', () => {
    const result = RootIdentitySchema.safeParse({
      rootSecretB64: 'c2VjcmV0',
      createdAt: Date.now(),
      passphraseArgon2Params: { t: 0, m: 19456, p: 1 },
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

describe('ServiceIdentityRecordSchema', () => {
  it('round-trips nested credentials and aliases arrays', () => {
    const record = {
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
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
      history: [{ action: 'created', at: Date.now() }],
    };
    const result = ServiceIdentityRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.credentials).toHaveLength(2);
      expect(result.data.aliases).toHaveLength(1);
    }
  });

  it('rejects a record missing identifierB64', () => {
    const result = ServiceIdentityRecordSchema.safeParse({
      origin: 'https://example.com',
      createdAt: Date.now(),
      credentials: [],
      aliases: [],
      history: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two credentials of the same kind for one service identity', () => {
    const result = ServiceIdentityRecordSchema.safeParse({
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentials: [
        { kind: 'password', username: 'alice', password: 'hunter2' },
        { kind: 'password', username: 'bob', password: 'swordfish' },
      ],
      aliases: [],
      history: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts one password and one passkey credential together', () => {
    const result = ServiceIdentityRecordSchema.safeParse({
      origin: 'https://example.com',
      identifierB64: 'aWRlbnRpZmllcg==',
      createdAt: Date.now(),
      credentials: [
        { kind: 'password', username: 'alice', password: 'hunter2' },
        { kind: 'passkey', rpId: 'example.com', credentialId: 'Y3JlZA' },
      ],
      aliases: [],
      history: [],
    });
    expect(result.success).toBe(true);
  });
});
