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
  vaultIndexExists,
} from './storage';
import { lockVault, unlockVault } from './unlock';

// vaultIndexExists(), not the old vaultBlobExists() -- a gap the tiering
// refactor's own Step 4 missed (this handler wasn't in that step's file
// list) and only surfaced as a real runtime test failure: createRootIdentity
// (Step 4) now writes the INDEX tier, so the old whole-blob key is never
// written anymore, and this would have permanently reported
// initialized: false for every vault ever created.
export async function handleVaultStatus(
  _message: VaultStatusMessage,
): Promise<VaultStatusResponse> {
  const [initialized, cachedKey, configuredUnlockMethod, passkeyCredentialId] = await Promise.all([
    vaultIndexExists(),
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
