import type {
  DeleteCredentialMessage,
  DeleteCredentialResponse,
  GetCredentialMessage,
  GetCredentialResponse,
  SaveCredentialMessage,
  SaveCredentialResponse,
} from '../../../shared/messages';
import { normalizeOrigin } from '../../../shared/origin';
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
