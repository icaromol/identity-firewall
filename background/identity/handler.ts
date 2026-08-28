import type {
  CreateServiceIdentityMessage,
  CreateServiceIdentityResponse,
  GetServiceIdentityMessage,
  GetServiceIdentityResponse,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { createServiceIdentity, getServiceIdentity } from './storage';

export async function handleGetServiceIdentity(
  message: GetServiceIdentityMessage,
): Promise<GetServiceIdentityResponse> {
  return getServiceIdentity(normalizeOrigin(message.payload.origin));
}

export async function handleCreateServiceIdentity(
  message: CreateServiceIdentityMessage,
): Promise<CreateServiceIdentityResponse> {
  return createServiceIdentity(normalizeOrigin(message.payload.origin));
}
