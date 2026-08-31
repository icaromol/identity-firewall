import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';
import type {
  AutofillFieldsMessage,
  DetectedField,
  FormDetectedMessage,
  FormSubmittedMessage,
} from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { tryLoadAutoApplyInputs, updateBadgeForTab } from '../badge';
import { classifyForm } from '../firewall/classifier';
import { detectLoginForm } from '../firewall/loginDetector';
import { computeAutoApply } from '../policy/autoApply';
import { recordDisclosure } from '../policy/ledger';
import { recordFormDetection } from '../session/state';
import { setPendingCredential } from '../vault/credentials/pendingCapture';

// Typed inline as the sender shape itself, not imported from
// router/registry.ts's HandlerContext -- that would make this leaf
// handler module reach back into the router that composes it, purely for
// a type. dispatch.ts's own MessageSender parameter (the type's real
// origin) is typed the same inline way.
export async function handleFormDetected(
  message: FormDetectedMessage,
  ctx: { sender: Browser.runtime.MessageSender },
): Promise<{ recorded: true }> {
  const { origin, forms, detectedAt } = message.payload;
  const classified = forms.map(classifyForm);

  const tabId = ctx.sender.tab?.id;
  const autoApplyInputs = await tryLoadAutoApplyInputs();

  // The actual auto-apply SIDE EFFECTS (relay AUTOFILL_FIELDS, record a
  // disclosure) happen here, per-form, in this one pass -- and this same
  // pass also accumulates askCount, cached alongside `forms` (Phase 5 M4)
  // so background/badge.ts's updateBadgeForTab can read it back without
  // redoing this same decrypt-and-resolve work on every later
  // FORM_SUBMITTED/CONFIRM/DISCARD_PENDING_CREDENTIAL call, none of which
  // change what's recognized or how policy resolves it (a /code-review
  // finding).
  let askCount = 0;

  for (const form of classified) {
    if (!autoApplyInputs) {
      askCount += form.fields.filter((f) => f.fieldType !== null).length;
      continue;
    }

    const result = computeAutoApply(origin, form, {
      policies: autoApplyInputs.policies,
      personalData: autoApplyInputs.personalData,
      isHighTrustOrigin: autoApplyInputs.isHighTrustOrigin(origin),
      aliasProviderConfigured: autoApplyInputs.aliasProviderConfigured,
    });

    if (!result.fullyResolved) {
      askCount += result.askCount;
      continue;
    }

    // Every recognized field on this form has a non-'ask' policy action --
    // act immediately, no popup involved (design decision 4). The Privacy
    // Ledger entry is what keeps this inspectable after the fact.
    if (tabId !== undefined && Object.keys(result.values).length > 0) {
      const autofillMessage: AutofillFieldsMessage = {
        type: 'AUTOFILL_FIELDS',
        payload: { formIndex: form.formIndex, values: result.values },
      };
      await browser.tabs.sendMessage(tabId, autofillMessage);
    }
    await recordDisclosure(
      origin,
      result.requestedFields,
      result.disclosedFields,
      result.deniedFields,
    );
  }

  await recordFormDetection(normalizeOrigin(origin), classified, detectedAt, askCount);

  if (tabId !== undefined) {
    await updateBadgeForTab(tabId, origin);
  }

  return { recorded: true };
}

// Phase 5 M4 -- captures a typed login on submit and stages it (never
// writes to the encrypted vault directly -- see pendingCapture.ts's own
// header comment). Re-runs detectLoginForm itself against the structural
// half of the submitted fields (value stripped) rather than trusting a
// content-script-side classification -- the same content-extracts/
// background-interprets boundary handleFormDetected already keeps.
export async function handleFormSubmitted(
  message: FormSubmittedMessage,
  ctx: { sender: Browser.runtime.MessageSender },
): Promise<{ captured: boolean }> {
  const { origin, fields } = message.payload;

  const structuralFields: DetectedField[] = fields.map(({ value: _value, ...field }) => field);
  const detected = detectLoginForm({
    formIndex: message.payload.formIndex,
    action: null,
    method: null,
    fields: structuralFields,
  });

  const password = detected ? fields[detected.passwordFieldIndex]?.value : undefined;
  if (!detected || !password) {
    // No password field detected, or it was submitted empty -- nothing
    // worth capturing either way.
    return { captured: false };
  }

  const identifierField =
    detected.identifierFieldIndex !== null ? fields[detected.identifierFieldIndex] : undefined;

  const normalizedOrigin = normalizeOrigin(origin);
  await setPendingCredential(normalizedOrigin, {
    identifier: identifierField?.value ?? null,
    password,
    capturedAt: Date.now(),
  });

  const tabId = ctx.sender.tab?.id;
  if (tabId !== undefined) {
    await updateBadgeForTab(tabId, origin);
  }

  return { captured: true };
}
