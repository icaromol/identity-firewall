import type {
  CreateRootIdentityMessage,
  VaultLockMessage,
  VaultStatusMessage,
  VaultStatusResponse,
  VaultUnlockMessage,
} from '../../shared/messages';
import { createRootIdentity } from './setup';
import {
  getCachedUnlockKey,
  getConfiguredUnlockMethod,
  getPasskeyCredentialId,
  vaultBlobExists,
} from './storage';
import { lockVault, unlockVault } from './unlock';

export async function handleVaultStatus(
  _message: VaultStatusMessage,
): Promise<VaultStatusResponse> {
  const [initialized, cachedKey, configuredUnlockMethod, passkeyCredentialId] = await Promise.all([
    vaultBlobExists(),
    getCachedUnlockKey(),
    getConfiguredUnlockMethod(),
    getPasskeyCredentialId(),
  ]);
  return { initialized, locked: cachedKey === null, configuredUnlockMethod, passkeyCredentialId };
}

export async function handleCreateRootIdentity(
  message: CreateRootIdentityMessage,
): Promise<Record<string, never>> {
  await createRootIdentity(message.payload);
  return {};
}

export async function handleVaultUnlock(
  message: VaultUnlockMessage,
): Promise<Record<string, never>> {
  await unlockVault(message.payload);
  return {};
}

export async function handleVaultLock(_message: VaultLockMessage): Promise<Record<string, never>> {
  await lockVault();
  return {};
}
