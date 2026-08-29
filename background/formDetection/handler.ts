import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';
import type { AutofillFieldsMessage, FormDetectedMessage } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { classifyForm } from '../firewall/classifier';
import { computeAutoApply } from '../policy/autoApply';
import { recordDisclosure } from '../policy/ledger';
import { getHighTrustOrigins, getPolicies } from '../policy/storage';
import { recordFormDetection } from '../session/state';
import { getPersonalData } from '../vault/personalData/storage';
import { readVaultIndex } from '../vault/storage';

// Undefined when the vault is locked (or otherwise unreadable) at the
// moment a form is detected -- automation is simply unavailable then,
// since generating a 'real' value needs PersonalData and every read here
// throws VaultLockedError otherwise. Every recognized field falls back to
// needing the popup's attention in that case, exactly as Phase 3 always
// behaved.
async function tryLoadAutoApplyInputs(): Promise<
  | {
      policies: Awaited<ReturnType<typeof getPolicies>>;
      personalData: Awaited<ReturnType<typeof getPersonalData>>;
      isHighTrustOrigin: (origin: string) => boolean;
      aliasProviderConfigured: boolean;
    }
  | undefined
> {
  try {
    const [policies, personalData, index, highTrustOrigins] = await Promise.all([
      getPolicies(),
      getPersonalData(),
      readVaultIndex(),
      getHighTrustOrigins(),
    ]);
    const normalizedHighTrust = new Set(highTrustOrigins.map((o) => normalizeOrigin(o)));
    return {
      policies,
      personalData,
      isHighTrustOrigin: (origin: string) => normalizedHighTrust.has(normalizeOrigin(origin)),
      aliasProviderConfigured: index.aliasProviderConfig.provider !== 'none',
    };
  } catch {
    return undefined;
  }
}

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
  await recordFormDetection(normalizeOrigin(origin), classified, detectedAt);

  const tabId = ctx.sender.tab?.id;
  const autoApplyInputs = await tryLoadAutoApplyInputs();

  // Toolbar badge now counts fields genuinely awaiting a decision, not
  // every recognized field (design decision 5) -- a form entirely covered
  // by policy shows no badge at all, since nothing needs the user's
  // attention.
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

  if (tabId !== undefined) {
    await browser.action.setBadgeText({ tabId, text: askCount > 0 ? String(askCount) : '' });
  }

  return { recorded: true };
}
