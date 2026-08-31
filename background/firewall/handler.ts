import { browser } from 'wxt/browser';
import { getFieldKey } from '../../shared/fieldKey';
import type {
  AutofillFieldsMessage,
  ClassifiedForm,
  GetPendingRequestMessage,
  GetPendingRequestResponse,
  SubmitFieldDecisionsMessage,
  SubmitFieldDecisionsResponse,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import type {
  PersonalData,
  PersonalDataFieldName,
  PolicyAction,
  ResponseType,
} from '../../shared/vault-schema';
import { recordDisclosure } from '../policy/ledger';
import { resolvePolicy } from '../policy/resolve';
import { getSessionState } from '../session/state';
import { assertTabShowsOrigin } from '../tabOriginGuard';
import { getPersonalData } from '../vault/personalData/storage';
import { readVaultIndex } from '../vault/storage';
import { availableResponses } from './responseAvailability';
import { generateResponseValue } from './responseGenerator';

async function loadPolicyContext() {
  const index = await readVaultIndex();
  const normalizedHighTrust = new Set(index.highTrustOrigins.map((o) => normalizeOrigin(o)));
  return {
    policies: index.policies,
    aliasProviderConfigured: index.aliasProviderConfig.provider !== 'none',
    isHighTrustOrigin: (origin: string) => normalizedHighTrust.has(normalizeOrigin(origin)),
  };
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

// Same one-entry-per-distinct-fieldType convention as
// computeAvailableResponses above -- a known simplification: two fields
// sharing a fieldType but differing apparentlyRequired within the SAME
// form would share whichever's resolution came first. Rare in practice
// (two recognized fields of the same type on one form), and the
// AUTOMATIC path (background/policy/autoApply.ts) resolves each field
// instance independently, so this only affects the popup's pre-fill
// display, never an actual disclosure decision.
function computeResolvedActions(
  origin: string,
  forms: ClassifiedForm[],
  policyContext: Awaited<ReturnType<typeof loadPolicyContext>>,
): Partial<Record<PersonalDataFieldName, PolicyAction>> {
  const result: Partial<Record<PersonalDataFieldName, PolicyAction>> = {};
  for (const form of forms) {
    for (const field of form.fields) {
      if (!field.fieldType || result[field.fieldType]) continue;
      result[field.fieldType] = resolvePolicy(
        origin,
        field.fieldType,
        policyContext.policies,
        policyContext.isHighTrustOrigin(origin),
        policyContext.aliasProviderConfigured,
        field.apparentlyRequired,
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
  const forms = record?.forms ?? [];

  const [personalData, policyContext] = await Promise.all([getPersonalData(), loadPolicyContext()]);

  // isHighTrustOrigin/resolvedActions are computed even when no form has
  // been detected this session (record is undefined, forms is empty) --
  // a /code-review finding: safe-mode status is a PERSISTENT per-origin
  // setting, not tied to session form-detection state, so the popup needs
  // to learn it (and show the warning banner) the moment it knows the
  // origin at all, not only once a form happens to exist. An empty
  // `forms` array already signals "nothing pending" via forms.length,
  // same as the previous `null` response did -- no caller distinguished
  // the two.
  return {
    forms,
    availableResponses: computeAvailableResponses(
      forms,
      personalData,
      policyContext.aliasProviderConfigured,
    ),
    resolvedActions: computeResolvedActions(message.payload.origin, forms, policyContext),
    isHighTrustOrigin: policyContext.isHighTrustOrigin(message.payload.origin),
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
  // if the tab navigates to a different site while the popup stays open
  // (e.g. a redirect, or the user following a link) and the user then
  // clicks Submit, this would otherwise resolve PersonalData for the OLD
  // origin and relay it via browser.tabs.sendMessage straight into the
  // NEW page -- a direct per-site isolation violation.
  await assertTabShowsOrigin(tabId, origin, 'autofill');

  const state = await getSessionState();
  const record = state.originForms[normalizeOrigin(origin)];
  const form = record?.forms.find((f) => f.formIndex === formIndex);
  if (!form) {
    throw new Error(`No pending request found for origin "${origin}", formIndex ${formIndex}`);
  }

  const [personalData, policyContext] = await Promise.all([getPersonalData(), loadPolicyContext()]);
  const aliasProviderConfigured = policyContext.aliasProviderConfigured;

  const resolvedValues: Record<string, string> = {};
  const requestedFields: PersonalDataFieldName[] = [];
  const disclosedFields: Partial<Record<PersonalDataFieldName, ResponseType>> = {};
  const deniedFields: PersonalDataFieldName[] = [];

  form.fields.forEach((field, fieldIndex) => {
    if (!field.fieldType) return;
    requestedFields.push(field.fieldType);

    const key = getFieldKey(field, fieldIndex);
    const responseType = decisions[key];
    // No decision made for a recognized field, or an explicit Deny, both
    // count as denied for the Privacy Ledger -- "what does this site know
    // about me" should reflect that nothing was handed over either way.
    if (!responseType || responseType === 'deny') {
      deniedFields.push(field.fieldType);
      return;
    }

    const hasRealValue = personalData[field.fieldType] !== undefined;
    const allowed = availableResponses(field.fieldType, hasRealValue, aliasProviderConfigured);
    if (!allowed.includes(responseType)) {
      throw new Error(
        `Response type "${responseType}" is not allowed for field "${key}" (fieldType "${field.fieldType}")`,
      );
    }

    const value = generateResponseValue(field.fieldType, responseType, personalData);
    if (value !== null) {
      resolvedValues[key] = value;
      disclosedFields[field.fieldType] = responseType;
    } else {
      deniedFields.push(field.fieldType);
    }
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
  await recordDisclosure(origin, requestedFields, disclosedFields, deniedFields);

  return { resolvedValues };
}
