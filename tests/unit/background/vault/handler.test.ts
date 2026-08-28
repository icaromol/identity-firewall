import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { randomBytes } from '../../../../background/vault/crypto';
import {
  handleCreateRootIdentity,
  handleVaultLock,
  handleVaultStatus,
  handleVaultUnlock,
} from '../../../../background/vault/handler';
import { VaultLockedError } from '../../../../background/vault/storage';
import { bytesToBase64 } from '../../../../shared/bytes';
import type {
  CreateRootIdentityMessage,
  VaultLockMessage,
  VaultStatusMessage,
  VaultUnlockMessage,
} from '../../../../shared/messages';

const passphraseInput = {
  unlockMethod: 'passphrase' as const,
  passphrase: 'correct horse battery staple',
};

const statusMessage: VaultStatusMessage = { type: 'VAULT_STATUS' };

describe('vault handlers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('walks the full state machine: uninitialized -> initialized+locked -> unlocked -> locked', async () => {
    expect(await handleVaultStatus(statusMessage)).toEqual({
      initialized: false,
      locked: true,
      configuredUnlockMethod: undefined,
      passkeyCredentialId: undefined,
    });

    const createMessage: CreateRootIdentityMessage = {
      type: 'CREATE_ROOT_IDENTITY',
      payload: passphraseInput,
    };
    await handleCreateRootIdentity(createMessage);

    // createRootIdentity caches the unlock key as its last step, so
    // immediately after setup the vault is initialized AND unlocked.
    expect(await handleVaultStatus(statusMessage)).toEqual({
      initialized: true,
      locked: false,
      configuredUnlockMethod: 'passphrase',
      passkeyCredentialId: undefined,
    });

    const lockMessage: VaultLockMessage = { type: 'VAULT_LOCK' };
    await handleVaultLock(lockMessage);

    expect(await handleVaultStatus(statusMessage)).toEqual({
      initialized: true,
      locked: true,
      configuredUnlockMethod: 'passphrase',
      passkeyCredentialId: undefined,
    });
  });

  it('handleVaultUnlock unlocks a locked vault', async () => {
    await handleCreateRootIdentity({ type: 'CREATE_ROOT_IDENTITY', payload: passphraseInput });
    await handleVaultLock({ type: 'VAULT_LOCK' });

    const unlockMessage: VaultUnlockMessage = {
      type: 'VAULT_UNLOCK',
      payload: passphraseInput,
    };
    await handleVaultUnlock(unlockMessage);

    expect((await handleVaultStatus(statusMessage)).locked).toBe(false);
  });

  it('handleVaultUnlock surfaces VaultLockedError-shaped failures with the literal error message intact', async () => {
    // No vault exists yet -- unlockVault throws VaultNotInitializedError,
    // whose .message ('VAULT_NOT_INITIALIZED') is what dispatch.ts's
    // err.message convention surfaces to the caller.
    const unlockMessage: VaultUnlockMessage = {
      type: 'VAULT_UNLOCK',
      payload: passphraseInput,
    };
    await expect(handleVaultUnlock(unlockMessage)).rejects.toThrow('VAULT_NOT_INITIALIZED');
  });

  it('handleCreateRootIdentity supports the passkey path too', async () => {
    const createMessage: CreateRootIdentityMessage = {
      type: 'CREATE_ROOT_IDENTITY',
      payload: {
        unlockMethod: 'passkey',
        prfOutputB64: bytesToBase64(randomBytes(32)),
        credentialId: 'fixture-credential-id',
        rpId: 'chrome-extension://fixture-extension-id',
      },
    };
    await handleCreateRootIdentity(createMessage);

    expect(await handleVaultStatus(statusMessage)).toEqual({
      initialized: true,
      locked: false,
      configuredUnlockMethod: 'passkey',
      passkeyCredentialId: 'fixture-credential-id',
    });
  });

  it('VaultLockedError carries the literal message dispatch.ts surfaces to callers', () => {
    expect(new VaultLockedError().message).toBe('VAULT_LOCKED');
  });
});
