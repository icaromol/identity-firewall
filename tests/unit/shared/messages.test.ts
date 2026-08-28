import { describe, expect, it } from 'vitest';
import {
  ExtensionMessageSchema,
  UnlockInputSchema,
  VaultBackupBundleSchema,
} from '../../../shared/messages';

describe('ExtensionMessageSchema', () => {
  it('accepts a valid FORM_DETECTED message', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/login',
        detectedAt: Date.now(),
        forms: [
          {
            formIndex: 0,
            action: '/login',
            method: 'post',
            fields: [
              { tagName: 'input', type: 'email', name: 'email', id: null, required: true },
              { tagName: 'input', type: 'password', name: 'password', id: null, required: true },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid GET_SESSION_STATE message with no payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'GET_SESSION_STATE' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid GET_ORIGIN_STATE message', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'GET_ORIGIN_STATE',
      payload: { origin: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'NOT_A_REAL_TYPE', payload: {} });
    expect(result.success).toBe(false);
  });

  it('rejects FORM_DETECTED with a missing required field', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        // url is missing
        detectedAt: Date.now(),
        forms: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects FORM_DETECTED with a wrong field type', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://example.com/login',
        detectedAt: 'not-a-number',
        forms: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects GET_ORIGIN_STATE with no origin', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'GET_ORIGIN_STATE', payload: {} });
    expect(result.success).toBe(false);
  });
});

describe('UnlockInputSchema', () => {
  it('accepts a passkey unlock input', () => {
    const result = UnlockInputSchema.safeParse({
      unlockMethod: 'passkey',
      prfOutputB64: 'cHJm',
      credentialId: 'Y3JlZA',
      rpId: 'example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a passphrase unlock input', () => {
    const result = UnlockInputSchema.safeParse({
      unlockMethod: 'passphrase',
      passphrase: 'correct horse battery staple',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unlockMethod outside the union', () => {
    const result = UnlockInputSchema.safeParse({ unlockMethod: 'biometric', passphrase: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a passkey variant missing prfOutputB64', () => {
    const result = UnlockInputSchema.safeParse({
      unlockMethod: 'passkey',
      credentialId: 'Y3JlZA',
      rpId: 'example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('vault lifecycle messages', () => {
  it('accepts VAULT_STATUS with no payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'VAULT_STATUS' });
    expect(result.success).toBe(true);
  });

  it('accepts CREATE_ROOT_IDENTITY with a passphrase unlock input', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'CREATE_ROOT_IDENTITY',
      payload: { unlockMethod: 'passphrase', passphrase: 'correct horse battery staple' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects CREATE_ROOT_IDENTITY with a missing payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'CREATE_ROOT_IDENTITY' });
    expect(result.success).toBe(false);
  });

  it('accepts VAULT_UNLOCK with a passkey unlock input', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'VAULT_UNLOCK',
      payload: {
        unlockMethod: 'passkey',
        prfOutputB64: 'cHJm',
        credentialId: 'Y3JlZA',
        rpId: 'example.com',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts VAULT_LOCK with no payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'VAULT_LOCK' });
    expect(result.success).toBe(true);
  });
});

describe('service identity messages', () => {
  it('accepts GET_SERVICE_IDENTITY with an origin', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'GET_SERVICE_IDENTITY',
      payload: { origin: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects GET_SERVICE_IDENTITY with no origin', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'GET_SERVICE_IDENTITY',
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it('accepts CREATE_SERVICE_IDENTITY with an origin', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'CREATE_SERVICE_IDENTITY',
      payload: { origin: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });
});

describe('personal data messages', () => {
  it('accepts GET_PERSONAL_DATA with no payload', () => {
    const result = ExtensionMessageSchema.safeParse({ type: 'GET_PERSONAL_DATA' });
    expect(result.success).toBe(true);
  });

  it('accepts SET_PERSONAL_DATA with a single-field patch', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SET_PERSONAL_DATA',
      payload: { email: 'alice@example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts SET_PERSONAL_DATA with an empty patch', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SET_PERSONAL_DATA',
      payload: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects SET_PERSONAL_DATA with a wrong field type', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SET_PERSONAL_DATA',
      payload: { email: 12345 },
    });
    expect(result.success).toBe(false);
  });
});

describe('credential messages', () => {
  it('accepts GET_CREDENTIAL with an origin', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'GET_CREDENTIAL',
      payload: { origin: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts SAVE_CREDENTIAL with a password credential', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SAVE_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        credential: { kind: 'password', username: 'alice', password: 'hunter2' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts SAVE_CREDENTIAL with a passkey credential', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SAVE_CREDENTIAL',
      payload: {
        origin: 'https://example.com',
        credential: { kind: 'passkey', rpId: 'example.com', credentialId: 'Y3JlZA' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects SAVE_CREDENTIAL with an invalid credential kind', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'SAVE_CREDENTIAL',
      payload: { origin: 'https://example.com', credential: { kind: 'otp', secret: 'ABC' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts DELETE_CREDENTIAL with an origin and kind', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'DELETE_CREDENTIAL',
      payload: { origin: 'https://example.com', kind: 'password' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects DELETE_CREDENTIAL with a kind outside the enum', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'DELETE_CREDENTIAL',
      payload: { origin: 'https://example.com', kind: 'otp' },
    });
    expect(result.success).toBe(false);
  });
});

describe('backup messages', () => {
  const validBundle = {
    formatVersion: 1,
    kdf: 'argon2id',
    kdfParams: { t: 3, m: 65536, p: 1 },
    argon2SaltB64: 'c2FsdA',
    ivB64: 'aXY',
    ciphertextB64: 'Y2lwaGVydGV4dA',
  };

  it('accepts EXPORT_VAULT_BACKUP with a passphrase', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'EXPORT_VAULT_BACKUP',
      payload: { backupPassphrase: 'correct horse battery staple' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts RESTORE_VAULT_BACKUP with a valid bundle and new unlock input', () => {
    const result = ExtensionMessageSchema.safeParse({
      type: 'RESTORE_VAULT_BACKUP',
      payload: {
        bundle: validBundle,
        backupPassphrase: 'correct horse battery staple',
        newUnlockInput: { unlockMethod: 'passphrase', passphrase: 'a new passphrase' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects RESTORE_VAULT_BACKUP with a bundle missing ciphertextB64', () => {
    const { ciphertextB64: _ciphertextB64, ...bundleWithoutCiphertext } = validBundle;
    const result = ExtensionMessageSchema.safeParse({
      type: 'RESTORE_VAULT_BACKUP',
      payload: {
        bundle: bundleWithoutCiphertext,
        backupPassphrase: 'correct horse battery staple',
        newUnlockInput: { unlockMethod: 'passphrase', passphrase: 'a new passphrase' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bundle with a kdf other than argon2id', () => {
    const result = VaultBackupBundleSchema.safeParse({ ...validBundle, kdf: 'pbkdf2' });
    expect(result.success).toBe(false);
  });

  it('rejects a bundle with non-positive Argon2 parameters', () => {
    const result = VaultBackupBundleSchema.safeParse({
      ...validBundle,
      kdfParams: { t: -1, m: 0, p: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bundle with Argon2 parameters above the ceiling', () => {
    const result = VaultBackupBundleSchema.safeParse({
      ...validBundle,
      kdfParams: { t: 4_294_967_295, m: 19456, p: 1 },
    });
    expect(result.success).toBe(false);
  });
});
