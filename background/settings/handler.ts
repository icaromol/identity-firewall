import type {
  GetAppSettingsMessage,
  GetAppSettingsResponse,
  SetAppSettingsMessage,
  SetAppSettingsResponse,
} from '../../shared/messages';
import { getAppSettings, setAppSettings } from './storage';

export async function handleGetAppSettings(
  _message: GetAppSettingsMessage,
): Promise<GetAppSettingsResponse> {
  return getAppSettings();
}

export async function handleSetAppSettings(
  message: SetAppSettingsMessage,
): Promise<SetAppSettingsResponse> {
  return setAppSettings(message.payload);
}
