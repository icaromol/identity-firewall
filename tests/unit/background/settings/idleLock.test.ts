import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  applyDetectionInterval,
  detectionIntervalSecondsFor,
  handleIdleStateChanged,
  initIdleLock,
  shouldLockOnIdleState,
} from '../../../../background/settings/idleLock';
import { setAppSettings } from '../../../../background/settings/storage';
import { generateAesGcmKeyFromBits, randomBytes } from '../../../../background/vault/crypto';
import { deriveVaultUnlockKey } from '../../../../background/vault/keys';
import { getOrCreateFixedAppSalt } from '../../../../background/vault/salt';
import { initializeVaultIndex, VaultLockedError } from '../../../../background/vault/storage';
import { requireUnlocked, unlockVault } from '../../../../background/vault/unlock';
import { bytesToBase64 } from '../../../../shared/bytes';
import type { UnlockInput } from '../../../../shared/messages';
import type { VaultIndex } from '../../../../shared/vault-schema';

function minimalVaultIndex(): VaultIndex {
  return {
    schemaVersion: 1,
    rootIdentity: { rootSecretB64: 'c2VjcmV0', createdAt: Date.now() },
    serviceIdentities: {},
    aliasProviderConfig: { provider: 'none' },
    policies: [],
    privacyLedger: [],
    highTrustOrigins: [],
  };
}

async function setUpUnlockedVault(): Promise<void> {
  const prfOutputB64 = bytesToBase64(randomBytes(32));
  const passkeyInput: UnlockInput = {
    unlockMethod: 'passkey',
    prfOutputB64,
    credentialId: 'Y3JlZA',
    rpId: 'example.com',
  };
  const fixedAppSalt = await getOrCreateFixedAppSalt();
  const bits = await deriveVaultUnlockKey(passkeyInput, fixedAppSalt);
  const key = await generateAesGcmKeyFromBits(bits);
  await initializeVaultIndex(minimalVaultIndex(), key);
  await unlockVault(passkeyInput);
}

describe('shouldLockOnIdleState', () => {
  it('locks on idle and locked, not on active', () => {
    expect(shouldLockOnIdleState('idle')).toBe(true);
    expect(shouldLockOnIdleState('locked')).toBe(true);
    expect(shouldLockOnIdleState('active')).toBe(false);
  });
});

describe('detectionIntervalSecondsFor', () => {
  it('clamps up to the 15-second floor', () => {
    expect(detectionIntervalSecondsFor(5)).toBe(15);
  });

  it('passes through a duration already at or above the floor', () => {
    expect(detectionIntervalSecondsFor(30)).toBe(30);
    expect(detectionIntervalSecondsFor(3600)).toBe(3600);
  });

  it('uses the floor for "Never" (null) -- irrelevant once locking is disabled', () => {
    expect(detectionIntervalSecondsFor(null)).toBe(15);
  });
});

describe('applyDetectionInterval / initIdleLock wiring', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('applyDetectionInterval calls chrome.idle.setDetectionInterval with the clamped value', async () => {
    const spy = vi.spyOn(fakeBrowser.idle, 'setDetectionInterval').mockResolvedValue(undefined);

    await applyDetectionInterval(5);

    expect(spy).toHaveBeenCalledWith(15);
  });

  // One test, one initIdleLock() call -- initIdleLock is guarded against
  // double-registration (a second call in the same worker lifetime is a
  // no-op), so exercising both the registration/startup-apply behavior
  // and the wired callback's own failure handling has to happen against
  // the same single call rather than two independent `it` blocks.
  it('registers exactly one listener synchronously, applies the stored interval, and logs (rather than swallows) a failure inside the wired callback', async () => {
    const intervalSpy = vi
      .spyOn(fakeBrowser.idle, 'setDetectionInterval')
      .mockResolvedValue(undefined);
    const listenerSpy = vi
      .spyOn(fakeBrowser.idle.onStateChanged, 'addListener')
      .mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await setAppSettings({ autoLockSeconds: 60 });
    initIdleLock();

    // The listener is registered in initIdleLock's own synchronous first
    // tick (an MV3 requirement -- see the function's own comment), so
    // this is already true before any awaiting.
    expect(listenerSpy).toHaveBeenCalledTimes(1);

    // Applying the stored interval happens on a subsequent microtask
    // (a .then chain, not an awaited call inside initIdleLock itself),
    // so this needs to be waited for rather than asserted immediately.
    await vi.waitFor(() => expect(intervalSpy).toHaveBeenCalledWith(60));

    // /code-review (angles A and B, the removed-behavior auditor) all
    // flagged the original `void handleIdleStateChanged(state)` inside
    // the registered listener as silently swallowing a failed lock
    // attempt -- with nothing to retry it before the *next* transition,
    // a single failure could leave the vault unlocked for the rest of an
    // idle period. getAppSettings (called inside handleIdleStateChanged)
    // reads storage; forcing that read to fail is the simplest way to
    // make the wired callback's promise actually reject.
    const registeredCallback = listenerSpy.mock.calls[0]?.[0] as (state: string) => void;
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('storage boom'));
    registeredCallback('idle');

    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
  });
});

describe('handleIdleStateChanged', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('locks the vault on "idle"', async () => {
    await setUpUnlockedVault();
    expect(await requireUnlocked()).toBeTruthy();

    await handleIdleStateChanged('idle');

    await expect(requireUnlocked()).rejects.toThrow(VaultLockedError);
  });

  it('locks the vault on "locked" (OS screen lock)', async () => {
    await setUpUnlockedVault();

    await handleIdleStateChanged('locked');

    await expect(requireUnlocked()).rejects.toThrow(VaultLockedError);
  });

  it('does nothing on "active"', async () => {
    await setUpUnlockedVault();

    await handleIdleStateChanged('active');

    expect(await requireUnlocked()).toBeTruthy();
  });

  it('does not lock on "idle" when autoLockSeconds is null ("Never")', async () => {
    await setUpUnlockedVault();
    await setAppSettings({ autoLockSeconds: null });

    await handleIdleStateChanged('idle');

    expect(await requireUnlocked()).toBeTruthy();
  });

  // The actual bug this test guards against: the first version of
  // handleIdleStateChanged gated BOTH 'idle' and 'locked' on the same
  // autoLockSeconds === null check, silently defeating the plan's own
  // decision 1 (docs/plans/autolock-and-configuration.md) that an OS
  // screen lock is a strictly stronger "walked away" signal than mere
  // inactivity and must always lock the vault -- caught by /code-review's
  // verification pass, not by the original test suite.
  it('locks on "locked" even when autoLockSeconds is null ("Never")', async () => {
    await setUpUnlockedVault();
    await setAppSettings({ autoLockSeconds: null });

    await handleIdleStateChanged('locked');

    await expect(requireUnlocked()).rejects.toThrow(VaultLockedError);
  });
});
