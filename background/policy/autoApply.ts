// Pure logic for Phase 4's automation path -- decides, for one classified
// form, whether every recognized field has a non-'ask' policy action and,
// if so, what values to autofill and what the resulting PrivacyLedger
// entry should record. No I/O here (no storage reads, no tabs.sendMessage)
// -- background/formDetection/handler.ts is the thin orchestrator that
// calls this with data it already read, then performs the actual relay
// and ledger write. See docs/plans/phase-4-privacy-ledger-policy-engine.md's
// design decision 4: fully automatic when every recognized field resolves,
// otherwise Phase 3's popup flow takes over exactly as before.

import { getFieldKey } from '../../shared/fieldKey';
import type { ClassifiedForm } from '../../shared/messages';
import type {
  PersonalData,
  PersonalDataFieldName,
  PolicyRule,
  ResponseType,
} from '../../shared/vault-schema';
import { generateResponseValue } from '../firewall/responseGenerator';
import { resolvePolicy } from './resolve';

export interface AutoApplyResult {
  // true iff every recognized field on this form resolved to a non-'ask'
  // action -- the ONLY condition under which values/AUTOFILL_FIELDS should
  // actually be relayed. False means "fall back to the popup," and the
  // fields below are meaningless in that case.
  fullyResolved: boolean;
  askCount: number;
  values: Record<string, string>; // fieldKey -> resolved value, for AUTOFILL_FIELDS
  requestedFields: PersonalDataFieldName[];
  disclosedFields: Partial<Record<PersonalDataFieldName, ResponseType>>;
  deniedFields: PersonalDataFieldName[];
}

export interface AutoApplyContext {
  policies: PolicyRule[];
  personalData: PersonalData;
  isHighTrustOrigin: boolean;
  aliasProviderConfigured: boolean;
}

export function computeAutoApply(
  origin: string,
  form: ClassifiedForm,
  context: AutoApplyContext,
): AutoApplyResult {
  const { policies, personalData, isHighTrustOrigin, aliasProviderConfigured } = context;

  const recognized = form.fields
    .map((field, index) => ({ field, key: getFieldKey(field, index) }))
    .filter(
      (entry): entry is typeof entry & { field: { fieldType: PersonalDataFieldName } } =>
        entry.field.fieldType !== null,
    );

  if (recognized.length === 0) {
    return {
      fullyResolved: false,
      askCount: 0,
      values: {},
      requestedFields: [],
      disclosedFields: {},
      deniedFields: [],
    };
  }

  const resolved = recognized.map((entry) => ({
    ...entry,
    action: resolvePolicy(
      origin,
      entry.field.fieldType,
      policies,
      isHighTrustOrigin,
      aliasProviderConfigured,
    ),
  }));

  const askCount = resolved.filter((r) => r.action === 'ask').length;
  if (askCount > 0) {
    return {
      fullyResolved: false,
      askCount,
      values: {},
      requestedFields: [],
      disclosedFields: {},
      deniedFields: [],
    };
  }

  const values: Record<string, string> = {};
  const disclosedFields: Partial<Record<PersonalDataFieldName, ResponseType>> = {};
  const deniedFields: PersonalDataFieldName[] = [];
  const requestedFields: PersonalDataFieldName[] = [];

  for (const r of resolved) {
    requestedFields.push(r.field.fieldType);

    if (r.action === 'deny') {
      deniedFields.push(r.field.fieldType);
      continue;
    }

    // askCount === 0 was already confirmed above, so every r.action here
    // is provably a ResponseType, never 'ask' -- TypeScript can't narrow
    // that across the loop on its own, hence the cast.
    const responseType = r.action as ResponseType;

    // A policy can say 'real' for a field PersonalData has no value for
    // yet (set before the user ever filled it in) -- generateResponseValue
    // returns null in that case, same as it would for a manual 'real'
    // choice with nothing on file. Treated as denied: there's nothing
    // honest to disclose.
    const value = generateResponseValue(r.field.fieldType, responseType, personalData);
    if (value === null) {
      deniedFields.push(r.field.fieldType);
      continue;
    }

    values[r.key] = value;
    disclosedFields[r.field.fieldType] = responseType;
  }

  return {
    fullyResolved: true,
    askCount: 0,
    values,
    requestedFields,
    disclosedFields,
    deniedFields,
  };
}
