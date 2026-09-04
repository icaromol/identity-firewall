// Pure logic for Phase 4's automation path -- decides, for one classified
// form, whether every recognized field has a non-'ask' policy action and,
// if so, what values to autofill and what the resulting PrivacyLedger
// entry should record. No STORAGE I/O here (background/formDetection/
// handler.ts is the thin orchestrator that calls this with data it
// already read, then performs the actual relay and ledger write) -- see
// docs/plans/phase-4-privacy-ledger-policy-engine.md's design decision 4:
// fully automatic when every recognized field resolves, otherwise Phase
// 3's popup flow takes over exactly as before.
//
// async since ADR-016 (Phase 5 M6): a Synthetic value now derives
// deterministically via Web Crypto's HKDF (generateResponseValue's own
// header comment), which has no synchronous form. This is the one way
// this function is no longer strictly "no I/O" -- crypto.subtle's own
// async-only API, not a storage/network read.

import { getFieldKey } from '../../shared/fieldKey';
import type { ClassifiedForm } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import type {
  PersonalData,
  PersonalDataFieldName,
  PolicyRule,
  ResponseType,
} from '../../shared/vault-schema';
import { generateResponseValue } from '../firewall/responseGenerator';
import { log } from '../logging/handler';
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
  // Phase 5 M6 -- needed only for a 'synthetic' resolution's deterministic
  // derivation (ADR-016). Threaded through from the same already-fetched
  // vault index this context's other fields come from -- no extra storage
  // read.
  rootSecret: Uint8Array;
}

export async function computeAutoApply(
  origin: string,
  form: ClassifiedForm,
  context: AutoApplyContext,
): Promise<AutoApplyResult> {
  const { policies, personalData, isHighTrustOrigin, aliasProviderConfigured, rootSecret } =
    context;

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
      entry.field.apparentlyRequired,
    ),
  }));

  // 'debug', not 'info' -- resolvePolicy runs once per recognized field,
  // potentially several times per form; at 'info' this would drown out
  // the coarser lifecycle events formDetection/handler.ts logs. Logged
  // here at resolvePolicy's own call site, not inside resolvePolicy
  // itself, which is documented pure/no-I/O logic (this file's own header
  // comment) -- adding a log() side effect there would be a design
  // regression nobody asked for.
  for (const r of resolved) {
    log('debug', 'Identity Firewall: policy resolved a field (auto-apply path)', {
      origin,
      fieldType: r.field.fieldType,
      action: r.action,
    });
  }

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
    const value = await generateResponseValue(
      r.field.fieldType,
      responseType,
      personalData,
      normalizeOrigin(origin),
      rootSecret,
    );
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
