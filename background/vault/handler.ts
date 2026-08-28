import type {
  CreateRootIdentityMessage,
  ExportVaultBackupMessage,
  ExportVaultBackupResponse,
  RestoreVaultBackupMessage,
  RestoreVaultBackupResponse,
  VaultLockMessage,
  VaultStatusMessage,
  VaultStatusResponse,
  VaultUnlockMessage,
} from '../../shared/messages';
import { exportVaultBackup, restoreVaultBackup } from './export';
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

export async function handleExportVaultBackup(
  message: ExportVaultBackupMessage,
): Promise<ExportVaultBackupResponse> {
  return exportVaultBackup(message.payload.backupPassphrase);
}

export async function handleRestoreVaultBackup(
  message: RestoreVaultBackupMessage,
): Promise<RestoreVaultBackupResponse> {
  await restoreVaultBackup(
    message.payload.bundle,
    message.payload.backupPassphrase,
    message.payload.newUnlockInput,
  );
  return {};
}
