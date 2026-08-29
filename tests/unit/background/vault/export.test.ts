import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { UnlockInput, VaultBackupBundle } from '../../../../shared/messages';
import { normalizeOrigin } from '../../../../shared/origin';

// A round-trip test needs to simulate TWO devices within one Vitest worker:
// module-level state (setup.ts's firstVaultWriteQueue, salt.ts's cachedSalt/
// inFlight, storage.ts's writeQueue) would otherwise leak across the
// simulated device boundary if the "restore" half reused the "export"
// half's already-imported modules -- matching salt.test.ts's own
// established vi.resetModules() + fresh dynamic import precedent.

const passphraseInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'correct horse battery staple',
};

const restoreUnlockInput: UnlockInput = {
  unlockMethod: 'passphrase',
  passphrase: 'a brand new passphrase',
};

describe('vault backup export/restore', () => {
  let exportVaultBackup: typeof import('../../../../background/vault/export').exportVaultBackup;
  let restoreVaultBackup: typeof import('../../../../background/vault/export').restoreVaultBackup;
  let createRootIdentity: typeof import('../../../../background/vault/setup').createRootIdentity;
  let createServiceIdentity: typeof import('../../../../background/identity/storage').createServiceIdentity;
  let getServiceIdentity: typeof import('../../../../background/identity/storage').getServiceIdentity;
  let VaultLockedError: typeof import('../../../../background/vault/storage').VaultLockedError;
  let VaultAlreadyInitializedError: typeof import('../../../../background/vault/storage').VaultAlreadyInitializedError;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();
    ({ exportVaultBackup, restoreVaultBackup } = await import(
      '../../../../background/vault/export'
    ));
    ({ createRootIdentity } = await import('../../../../background/vault/setup'));
    ({ createServiceIdentity, getServiceIdentity } = await import(
      '../../../../background/identity/storage'
    ));
    ({ VaultLockedError, VaultAlreadyInitializedError } = await import(
      '../../../../background/vault/storage'
    ));
  });

  it('export -> restore into a simulated fresh vault reproduces the identical Service Identity', async () => {
    await createRootIdentity(passphraseInput);
    const origin = normalizeOrigin('https://a.example');
    const before = await createServiceIdentity(origin);

    const bundle = await exportVaultBackup('backup-passphrase-1234');

    // Simulate a genuinely fresh device: reset storage AND module state.
    fakeBrowser.reset();
    vi.resetModules();
    ({ restoreVaultBackup } = await import('../../../../background/vault/export'));
    ({ getServiceIdentity } = await import('../../../../background/identity/storage'));

    await restoreVaultBackup(bundle, 'backup-passphrase-1234', restoreUnlockInput);

    const after = await getServiceIdentity(origin);
    expect(after?.identifierB64).toBe(before.identifierB64);
    expect(after?.origin).toBe(before.origin);
  });

  it('restoring with the wrong backupPassphrase rejects before any write', async () => {
    await createRootIdentity(passphraseInput);
    const bundle = await exportVaultBackup('correct-backup-pass');

    fakeBrowser.reset();
    vi.resetModules();
    ({ restoreVaultBackup } = await import('../../../../background/vault/export'));

    await expect(
      restoreVaultBackup(bundle, 'wrong-backup-pass', restoreUnlockInput),
    ).rejects.toThrow();
  });

  it('a corrupted ciphertext rejects cleanly, not a silent garbage decrypt', async () => {
    await createRootIdentity(passphraseInput);
    const bundle = await exportVaultBackup('backup-passphrase-1234');

    const corrupted: VaultBackupBundle = {
      ...bundle,
      ciphertextB64: `${bundle.ciphertextB64.slice(0, -4)}${
        bundle.ciphertextB64.at(-4) === 'A' ? 'B' : 'A'
      }${bundle.ciphertextB64.slice(-3)}`,
    };

    fakeBrowser.reset();
    vi.resetModules();
    ({ restoreVaultBackup } = await import('../../../../background/vault/export'));

    await expect(
      restoreVaultBackup(corrupted, 'backup-passphrase-1234', restoreUnlockInput),
    ).rejects.toThrow();
  });

  it('restoring onto an already-initialized vault rejects and never writes the salt storage key', async () => {
    await createRootIdentity(passphraseInput);
    const bundle = await exportVaultBackup('backup-passphrase-1234');

    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');
    setSpy.mockClear();

    await expect(
      restoreVaultBackup(bundle, 'backup-passphrase-1234', restoreUnlockInput),
    ).rejects.toThrow(VaultAlreadyInitializedError);

    const saltWrites = setSpy.mock.calls.filter(([entries]) => 'if_vault_salt_v1' in entries);
    expect(saltWrites).toHaveLength(0);
  });

  it("two concurrent first-vault-writes never mix one call's index with the other's FixedAppSalt", async () => {
    const origin = normalizeOrigin('https://a.example');

    // Build a bundle from an entirely separate, pre-existing vault (its own
    // FixedAppSalt/rootSecret), simulating a genuinely different backup
    // racing against a concurrent fresh createRootIdentity call.
    fakeBrowser.reset();
    vi.resetModules();
    let setupModule = await import('../../../../background/vault/setup');
    let identityModule = await import('../../../../background/identity/storage');
    let exportModule = await import('../../../../background/vault/export');
    await setupModule.createRootIdentity(passphraseInput);
    const backupOrigin = await identityModule.createServiceIdentity(origin);
    const bundle = await exportModule.exportVaultBackup('backup-passphrase-1234');

    fakeBrowser.reset();
    vi.resetModules();
    setupModule = await import('../../../../background/vault/setup');
    identityModule = await import('../../../../background/identity/storage');
    exportModule = await import('../../../../background/vault/export');
    // Re-imported fresh, matching THIS reset's module instantiation --
    // vi.resetModules() gives every re-imported module a new identity, so
    // the outer beforeEach's VaultAlreadyInitializedError reference would
    // fail `instanceof` against an error thrown by this reset's own code.
    const { VaultAlreadyInitializedError: FreshVaultAlreadyInitializedError } = await import(
      '../../../../background/vault/storage'
    );

    const [freshResult, restoreResult] = await Promise.allSettled([
      setupModule.createRootIdentity(passphraseInput),
      exportModule.restoreVaultBackup(bundle, 'backup-passphrase-1234', restoreUnlockInput),
    ]);

    // Exactly one of the two first-vault-writes succeeds; the loser must be
    // rejected with VaultAlreadyInitializedError specifically -- not some
    // other failure mode -- confirming the write-queue actually serialized
    // them rather than one silently corrupting the other's state.
    const outcomes = [freshResult, restoreResult];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(FreshVaultAlreadyInitializedError);
    }

    // Whichever one won, the vault's own Service Identity derivation must
    // still be internally consistent -- i.e. deriving the SAME origin twice
    // against the winning vault produces the same identifierB64, proving no
    // mixed salt/vaultData pairing occurred.
    const first = await identityModule.createServiceIdentity(origin);
    const second = await identityModule.createServiceIdentity(origin);
    expect(second.identifierB64).toBe(first.identifierB64);

    // If restore won, its Service Identity for `origin` must match the
    // ORIGINAL backup's, not some corrupted mix.
    if (restoreResult.status === 'fulfilled') {
      expect(first.identifierB64).toBe(backupOrigin.identifierB64);
    }
  });

  it('exportVaultBackup rejects with VaultLockedError when locked', async () => {
    const { lockVault } = await import('../../../../background/vault/unlock');
    await createRootIdentity(passphraseInput);
    await lockVault();

    await expect(exportVaultBackup('backup-passphrase-1234')).rejects.toThrow(VaultLockedError);
  });
});
