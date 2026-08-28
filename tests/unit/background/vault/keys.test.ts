import { describe, expect, it } from 'vitest';
import {
  decryptBlob,
  encryptBlob,
  generateAesGcmKeyFromBits,
  randomBytes,
} from '../../../../background/vault/crypto';
import {
  DEFAULT_ARGON2_PARAMS,
  deriveBackupExportKey,
  deriveVaultUnlockKey,
  generateRootSecret,
} from '../../../../background/vault/keys';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { UnlockInput } from '../../../../shared/messages';
import type { Argon2Params } from '../../../../shared/vault-schema';

// Cheap params so the memory-hard Argon2id computation stays fast across the
// many determinism/round-trip cases below -- DEFAULT_ARGON2_PARAMS is only
// exercised once, directly, further down.
const CHEAP_ARGON2_PARAMS: Argon2Params = { t: 1, m: 8, p: 1 };

const passkeyInput = (): UnlockInput => ({
  unlockMethod: 'passkey',
  prfOutputB64: bytesToBase64(randomBytes(32)),
  credentialId: 'Y3JlZA',
  rpId: 'example.com',
});

const passphraseInput = (): UnlockInput => ({
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
});

async function roundTrips(key: CryptoKey): Promise<boolean> {
  const plaintext = new TextEncoder().encode('hello vault');
  const { iv, ciphertext } = await encryptBlob(key, plaintext);
  const decrypted = await decryptBlob(key, iv, ciphertext);
  return new TextDecoder().decode(decrypted) === 'hello vault';
}

describe('deriveVaultUnlockKey', () => {
  it('derives usable raw key bits from a passkey UnlockInput', async () => {
    const fixedAppSalt = randomBytes(32);
    const bits = await deriveVaultUnlockKey(passkeyInput(), fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const key = await generateAesGcmKeyFromBits(bits);
    expect(await roundTrips(key)).toBe(true);
  });

  it('derives usable raw key bits from a passphrase UnlockInput', async () => {
    const fixedAppSalt = randomBytes(32);
    const bits = await deriveVaultUnlockKey(passphraseInput(), fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const key = await generateAesGcmKeyFromBits(bits);
    expect(await roundTrips(key)).toBe(true);
  });

  it('is deterministic for the same passkey input and salt', async () => {
    const fixedAppSalt = randomBytes(32);
    const input = passkeyInput();

    const bitsA = await deriveVaultUnlockKey(input, fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const bitsB = await deriveVaultUnlockKey(input, fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const keyA = await generateAesGcmKeyFromBits(bitsA);
    const keyB = await generateAesGcmKeyFromBits(bitsB);

    const plaintext = new TextEncoder().encode('hello vault');
    const { iv, ciphertext } = await encryptBlob(keyA, plaintext);
    const decrypted = await decryptBlob(keyB, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('is deterministic for the same passphrase input and salt', async () => {
    const fixedAppSalt = randomBytes(32);
    const input = passphraseInput();

    const bitsA = await deriveVaultUnlockKey(input, fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const bitsB = await deriveVaultUnlockKey(input, fixedAppSalt, CHEAP_ARGON2_PARAMS);
    const keyA = await generateAesGcmKeyFromBits(bitsA);
    const keyB = await generateAesGcmKeyFromBits(bitsB);

    const plaintext = new TextEncoder().encode('hello vault');
    const { iv, ciphertext } = await encryptBlob(keyA, plaintext);
    const decrypted = await decryptBlob(keyB, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('derives bits that cannot decrypt ciphertext produced under a different fixedAppSalt', async () => {
    const input = passkeyInput();
    const bitsA = await deriveVaultUnlockKey(input, randomBytes(32), CHEAP_ARGON2_PARAMS);
    const bitsB = await deriveVaultUnlockKey(input, randomBytes(32), CHEAP_ARGON2_PARAMS);
    const keyA = await generateAesGcmKeyFromBits(bitsA);
    const keyB = await generateAesGcmKeyFromBits(bitsB);

    const plaintext = new TextEncoder().encode('hello vault');
    const { iv, ciphertext } = await encryptBlob(keyA, plaintext);

    await expect(decryptBlob(keyB, iv, ciphertext)).rejects.toThrow();
  });

  it('works end to end with DEFAULT_ARGON2_PARAMS (the real production cost)', async () => {
    const fixedAppSalt = randomBytes(32);
    const bits = await deriveVaultUnlockKey(passphraseInput(), fixedAppSalt, DEFAULT_ARGON2_PARAMS);
    const key = await generateAesGcmKeyFromBits(bits);
    expect(await roundTrips(key)).toBe(true);
  });
});

describe('generateRootSecret', () => {
  it('returns 32 bytes', () => {
    expect(generateRootSecret()).toHaveLength(32);
  });

  it('returns different values across calls', () => {
    expect(generateRootSecret()).not.toEqual(generateRootSecret());
  });
});

describe('deriveBackupExportKey', () => {
  it('derives a usable AES-GCM key that round-trips', async () => {
    const argon2Salt = randomBytes(16);
    const key = await deriveBackupExportKey('backup passphrase', argon2Salt, CHEAP_ARGON2_PARAMS);
    expect(await roundTrips(key)).toBe(true);
  });

  it('is deterministic for the same passphrase and salt', async () => {
    const argon2Salt = randomBytes(16);
    const keyA = await deriveBackupExportKey('backup passphrase', argon2Salt, CHEAP_ARGON2_PARAMS);
    const keyB = await deriveBackupExportKey('backup passphrase', argon2Salt, CHEAP_ARGON2_PARAMS);

    const plaintext = new TextEncoder().encode('hello vault');
    const { iv, ciphertext } = await encryptBlob(keyA, plaintext);
    const decrypted = await decryptBlob(keyB, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('derives a different key than the passphrase-unlock path, even with the same passphrase and salt', async () => {
    const sharedSalt = randomBytes(32);
    const passphrase = 'same passphrase reused on purpose';

    const unlockBits = await deriveVaultUnlockKey(
      { unlockMethod: 'passphrase', passphrase },
      sharedSalt,
      CHEAP_ARGON2_PARAMS,
    );
    const unlockKey = await generateAesGcmKeyFromBits(unlockBits);
    const backupKey = await deriveBackupExportKey(passphrase, sharedSalt, CHEAP_ARGON2_PARAMS);

    const plaintext = new TextEncoder().encode('hello vault');
    const { iv, ciphertext } = await encryptBlob(unlockKey, plaintext);

    await expect(decryptBlob(backupKey, iv, ciphertext)).rejects.toThrow();
  });
});
