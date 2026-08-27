import type {
  GetOriginStateMessage,
  GetSessionStateMessage,
  OriginSummary,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { getSessionState } from './state';

export async function handleGetSessionState(
  _message: GetSessionStateMessage,
): Promise<{ originsWithForms: OriginSummary[] }> {
  const state = await getSessionState();
  return {
    originsWithForms: Object.entries(state.originForms).map(([origin, record]) => ({
      origin,
      ...record,
    })),
  };
}

export async function handleGetOriginState(
  message: GetOriginStateMessage,
): Promise<{ formCount: number; lastDetectedAt: number } | null> {
  const state = await getSessionState();
  return state.originForms[normalizeOrigin(message.payload.origin)] ?? null;
}
