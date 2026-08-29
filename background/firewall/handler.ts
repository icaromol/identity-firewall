import { browser } from 'wxt/browser';
import { getFieldKey } from '../../shared/fieldKey';
import type {
  AutofillFieldsMessage,
  ClassifiedForm,
  GetPendingRequestMessage,
  GetPendingRequestResponse,
  PersonalDataFieldName,
  SubmitFieldDecisionsMessage,
  SubmitFieldDecisionsResponse,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import type { PersonalData, ResponseType } from '../../shared/vault-schema';
import { getSessionState } from '../session/state';
import { getPersonalData } from '../vault/personalData/storage';
import { readVaultIndex } from '../vault/storage';
import { availableResponses } from './responseAvailability';
import { generateResponseValue } from './responseGenerator';

async function isAliasProviderConfigured(): Promise<boolean> {
  const index = await readVaultIndex();
  return index.aliasProviderConfig.provider !== 'none';
}

// One entry per distinct fieldType actually present in `forms` -- two
// fields sharing a fieldType always share the same availability, so this
// avoids recomputing (and re-sending) the identical array once per field.
function computeAvailableResponses(
  forms: ClassifiedForm[],
  personalData: PersonalData,
  aliasProviderConfigured: boolean,
): Partial<Record<PersonalDataFieldName, ResponseType[]>> {
  const result: Partial<Record<PersonalDataFieldName, ResponseType[]>> = {};
  for (const form of forms) {
    for (const field of form.fields) {
      if (!field.fieldType || result[field.fieldType]) continue;
      const hasRealValue = personalData[field.fieldType] !== undefined;
      result[field.fieldType] = availableResponses(
        field.fieldType,
        hasRealValue,
        aliasProviderConfigured,
      );
    }
  }
  return result;
}

// Requires the vault to be unlocked -- getPersonalData()/readVaultIndex()
// both throw VaultLockedError otherwise, surfaced to the popup as a normal
// {ok:false} response. There's nothing meaningful this UI can show without
// PersonalData anyway (every response type either reads it or needs to
// know it's absent), so this isn't a workaround-able limitation.
export async function handleGetPendingRequest(
  message: GetPendingRequestMessage,
): Promise<GetPendingRequestResponse> {
  const state = await getSessionState();
  const record = state.originForms[normalizeOrigin(message.payload.origin)];
  if (!record) return null;

  const [personalData, aliasProviderConfigured] = await Promise.all([
    getPersonalData(),
    isAliasProviderConfigured(),
  ]);

  return {
    forms: record.forms,
    availableResponses: computeAvailableResponses(
      record.forms,
      personalData,
      aliasProviderConfigured,
    ),
  };
}

// Re-derives fieldType/sensitivity from the session's own already-classified
// record rather than trusting anything the client sends about a field's
// type -- the popup only ever sends { key -> ResponseType }, everything
// else about the field is looked up server-side, so a compromised/buggy
// popup can't smuggle in a fieldType the classifier never actually assigned.
export async function handleSubmitFieldDecisions(
  message: SubmitFieldDecisionsMessage,
): Promise<SubmitFieldDecisionsResponse> {
  const { origin, tabId, formIndex, decisions } = message.payload;

  // Re-confirms the tab is STILL on the origin these decisions were made
  // for, before resolving or relaying anything -- a /code-review finding:
  // origin/tabId are captured once when the popup opens and cached in
  // stores/firewall.store.ts's state. If the tab navigates to a different
  // site while the popup stays open (e.g. a redirect, or the user
  // following a link) and the user then clicks Submit, this would
  // otherwise resolve PersonalData for the OLD origin and relay it via
  // browser.tabs.sendMessage straight into the NEW page -- a direct
  // per-site isolation violation. tab.url comes back stripped/undefined
  // once the 'activeTab' grant for that tab is revoked by navigation (see
  // wxt.config.ts's own comment on that permission), which is exactly the
  // signal this check needs: no visible url, no proof of origin, refuse.
  const tab = await browser.tabs.get(tabId);
  if (!tab?.url || normalizeOrigin(tab.url) !== normalizeOrigin(origin)) {
    throw new Error(`Refusing to autofill: tab ${tabId} is no longer showing origin "${origin}"`);
  }

  const state = await getSessionState();
  const record = state.originForms[normalizeOrigin(origin)];
  const form = record?.forms.find((f) => f.formIndex === formIndex);
  if (!form) {
    throw new Error(`No pending request found for origin "${origin}", formIndex ${formIndex}`);
  }

  const [personalData, aliasProviderConfigured] = await Promise.all([
    getPersonalData(),
    isAliasProviderConfigured(),
  ]);

  const resolvedValues: Record<string, string> = {};
  form.fields.forEach((field, fieldIndex) => {
    const key = getFieldKey(field, fieldIndex);
    const responseType = decisions[key];
    if (!responseType || !field.fieldType) return;

    const hasRealValue = personalData[field.fieldType] !== undefined;
    const allowed = availableResponses(field.fieldType, hasRealValue, aliasProviderConfigured);
    if (!allowed.includes(responseType)) {
      throw new Error(
        `Response type "${responseType}" is not allowed for field "${key}" (fieldType "${field.fieldType}")`,
      );
    }

    const value = generateResponseValue(field.fieldType, responseType, personalData);
    if (value !== null) resolvedValues[key] = value;
  });

  const autofillMessage: AutofillFieldsMessage = {
    type: 'AUTOFILL_FIELDS',
    payload: { formIndex, values: resolvedValues },
  };
  // Tab-scoped via browser.tabs.sendMessage, not browser.runtime.sendMessage
  // -- this reaches the ONE tab's content script directly, never
  // background/router/dispatch.ts's own listener (that only ever receives
  // content-script/popup -> background traffic).
  await browser.tabs.sendMessage(tabId, autofillMessage);

  return { resolvedValues };
}
