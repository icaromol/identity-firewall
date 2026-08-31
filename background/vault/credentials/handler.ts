import type {
  ConfirmPendingCredentialMessage,
  ConfirmPendingCredentialResponse,
  DeleteCredentialMessage,
  DeleteCredentialResponse,
  DiscardPendingCredentialMessage,
  DiscardPendingCredentialResponse,
  GetCredentialMessage,
  GetCredentialResponse,
  GetPendingCredentialMessage,
  GetPendingCredentialResponse,
  SaveCredentialMessage,
  SaveCredentialResponse,
} from '../../../shared/messages';
import { normalizeOrigin } from '../../../shared/origin';
import { updateBadgeForTab } from '../../badge';
import { assertTabShowsOrigin } from '../../tabOriginGuard';
import { clearPendingCredential, getPendingCredential } from './pendingCapture';
import { deleteCredential, getCredentials, saveCredential } from './storage';

export async function handleGetCredential(
  message: GetCredentialMessage,
): Promise<GetCredentialResponse> {
  return getCredentials(normalizeOrigin(message.payload.origin));
}

export async function handleSaveCredential(
  message: SaveCredentialMessage,
): Promise<SaveCredentialResponse> {
  return saveCredential(normalizeOrigin(message.payload.origin), message.payload.credential);
}

export async function handleDeleteCredential(
  message: DeleteCredentialMessage,
): Promise<DeleteCredentialResponse> {
  await deleteCredential(normalizeOrigin(message.payload.origin), message.payload.kind);
}

export async function handleGetPendingCredential(
  message: GetPendingCredentialMessage,
): Promise<GetPendingCredentialResponse> {
  return getPendingCredential(normalizeOrigin(message.payload.origin));
}

// tabId re-verification (tabOriginGuard.ts) -- a stale, cached origin (the
// tab navigated away while the popup stayed open) must never write a
// credential for the wrong site.
export async function handleConfirmPendingCredential(
  message: ConfirmPendingCredentialMessage,
): Promise<ConfirmPendingCredentialResponse> {
  const { origin, tabId } = message.payload;
  const normalizedOrigin = normalizeOrigin(origin);

  await assertTabShowsOrigin(tabId, origin, 'save credential');

  const pending = await getPendingCredential(normalizedOrigin);
  if (!pending) {
    throw new Error(`No pending credential to confirm for origin "${origin}"`);
  }

  const saved = await saveCredential(normalizedOrigin, {
    kind: 'password',
    username: pending.identifier,
    password: pending.password,
  });
  await clearPendingCredential(normalizedOrigin);
  await updateBadgeForTab(tabId, origin);

  return saved;
}

export async function handleDiscardPendingCredential(
  message: DiscardPendingCredentialMessage,
): Promise<DiscardPendingCredentialResponse> {
  const { origin, tabId } = message.payload;
  await clearPendingCredential(normalizeOrigin(origin));
  await updateBadgeForTab(tabId, origin);
}
