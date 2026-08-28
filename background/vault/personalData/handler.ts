import type {
  GetPersonalDataMessage,
  GetPersonalDataResponse,
  SetPersonalDataMessage,
  SetPersonalDataResponse,
} from '../../../shared/messages';
import { getPersonalData, setPersonalData } from './storage';

export async function handleGetPersonalData(
  _message: GetPersonalDataMessage,
): Promise<GetPersonalDataResponse> {
  return getPersonalData();
}

export async function handleSetPersonalData(
  message: SetPersonalDataMessage,
): Promise<SetPersonalDataResponse> {
  return setPersonalData(message.payload);
}
