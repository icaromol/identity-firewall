// System-wide idle detection (chrome.idle), not extension-specific
// activity tracking -- matching how comparable password-manager
// extensions (1Password/Bitwarden-style) behave. Reversible later if the
// user wants the stricter model instead (see docs/plans/autolock-and-
// configuration.md).
//
// chrome.idle.setDetectionInterval() has a hard-enforced 15-second floor
// (confirmed via MDN + Chrome for Developers docs -- see the plan doc's
// own citations); values below it are silently clamped by the browser
// itself, but clamping explicitly here keeps the applied value legible
// to the Configuration UI and to tests.
//
// 'Never' (autoLockSeconds === null) is deliberately NOT implemented by
// disabling detection -- chrome.idle has no such mode, only an interval.
// Instead the detection interval stays at the floor (so a later switch
// back to a real duration takes effect immediately) and the state-
// change handler itself reads the live setting and no-ops when it's
// 'Never' -- but only for plain 'idle'. 'locked' (the OS screen actually
// locking) is a strictly stronger "walked away" signal than mere
// inactivity and always locks the vault regardless of the configured
// duration, including 'Never' (docs/plans/autolock-and-configuration.md's
// own decision 1: "a screen lock is an even stronger 'walked away'
// signal"). Caught by /code-review's verification pass -- the first
// version of handleIdleStateChanged gated 'locked' on the same null
// check as 'idle', silently defeating that decision for anyone who chose
// "Never".

import { browser } from 'wxt/browser';
import { MIN_AUTO_LOCK_SECONDS } from '../../shared/settings';
import { lockVault } from '../vault/unlock';
import { getAppSettings } from './storage';

const LOCKING_STATES: ReadonlySet<string> = new Set(['idle', 'locked']);

export function shouldLockOnIdleState(state: string): boolean {
  return LOCKING_STATES.has(state);
}

export function detectionIntervalSecondsFor(autoLockSeconds: number | null): number {
  if (autoLockSeconds === null) return MIN_AUTO_LOCK_SECONDS;
  return Math.max(MIN_AUTO_LOCK_SECONDS, autoLockSeconds);
}

export async function applyDetectionInterval(autoLockSeconds: number | null): Promise<void> {
  await browser.idle.setDetectionInterval(detectionIntervalSecondsFor(autoLockSeconds));
}

export async function handleIdleStateChanged(state: string): Promise<void> {
  if (!shouldLockOnIdleState(state)) return;

  if (state === 'locked') {
    await lockVault();
    return;
  }

  const settings = await getAppSettings();
  if (settings.autoLockSeconds === null) return;

  await lockVault();
}

// Registers the onStateChanged listener synchronously, in this function's
// own first tick, before any await -- an MV3 service worker only reliably
// associates an event listener with itself if the listener is added
// during the worker's initial synchronous run, not after a pending
// promise resolves (https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events).
// Registering it after an await risked Chrome never delivering
// idle/locked events to a respawned worker at all.
//
// Both the per-event handler and the startup interval-application are
// deliberately NOT `void`-fire-and-forgotten -- each gets its own
// `.catch` that logs. `handleIdleStateChanged` failing on a single
// active->idle transition would otherwise leave the vault unlocked for
// the rest of that idle period with nothing anywhere to say so (the next
// onStateChanged event only fires on the *next* transition); a startup
// failure here would otherwise leave auto-lock permanently, silently
// off for that worker's whole lifetime. This is the one security-
// relevant background listener in the extension, so failing loudly to
// the console beats failing invisibly.
// Guards against ever registering the listener twice in the same
// service-worker lifetime -- initIdleLock is currently only called once,
// from entrypoints/background.ts's own top level, but nothing besides
// this flag would stop a future caller from adding a second, duplicate
// listener that double-fires lockVault() (and a duplicate getAppSettings
// read) on every idle/locked transition.
let listenerRegistered = false;

export function initIdleLock(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;

  browser.idle.onStateChanged.addListener((state) => {
    handleIdleStateChanged(state).catch((err) => {
      console.error('Identity Firewall: idle-lock state-change handler failed', err);
    });
  });

  getAppSettings()
    .then((settings) => applyDetectionInterval(settings.autoLockSeconds))
    .catch((err) => {
      console.error('Identity Firewall: failed to apply the stored auto-lock interval', err);
    });
}
