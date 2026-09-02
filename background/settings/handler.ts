import type {
  GetAppSettingsMessage,
  GetAppSettingsResponse,
  SetAppSettingsMessage,
  SetAppSettingsResponse,
} from '../../shared/messages';
import { applyDetectionInterval } from './idleLock';
import { getAppSettings, setAppSettings } from './storage';

export async function handleGetAppSettings(
  _message: GetAppSettingsMessage,
): Promise<GetAppSettingsResponse> {
  return getAppSettings();
}

export async function handleSetAppSettings(
  message: SetAppSettingsMessage,
): Promise<SetAppSettingsResponse> {
  const next = await setAppSettings(message.payload);

  // Re-apply immediately, but only when this patch actually touched
  // autoLockSeconds -- otherwise every unrelated save (e.g. just
  // credentialSaveMode) would needlessly call the chrome.idle API too.
  // Without re-applying at all, a duration change from the Configuration
  // tab wouldn't take effect until the next browser restart (initIdleLock
  // only runs once, at background-script startup).
  //
  // Caught, not awaited-and-thrown: the settings write above already
  // succeeded and is durably persisted, so a transient chrome.idle
  // failure here must not turn this into a reported save failure --
  // that would leave the UI showing the old value/an error while
  // storage already holds the new one, a worse outcome than a
  // console-only log of a failed *side effect* of an otherwise-successful
  // save.
  if (message.payload.autoLockSeconds !== undefined) {
    try {
      await applyDetectionInterval(next.autoLockSeconds);
    } catch (err) {
      console.error('Identity Firewall: failed to apply the new auto-lock interval', err);
    }
  }

  return next;
}
