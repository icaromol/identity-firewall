import type { GetPendingRequestMessage, GetPendingRequestResponse } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { getSessionState } from '../session/state';

export async function handleGetPendingRequest(
  message: GetPendingRequestMessage,
): Promise<GetPendingRequestResponse> {
  const state = await getSessionState();
  const record = state.originForms[normalizeOrigin(message.payload.origin)];
  return record?.forms ?? null;
}
