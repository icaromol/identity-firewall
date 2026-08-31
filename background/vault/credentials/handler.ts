import { browser } from 'wxt/browser';
import { getFieldKey } from '../../../shared/fieldKey';
import type {
  AutofillFieldsMessage,
  ConfirmPendingCredentialMessage,
  ConfirmPendingCredentialResponse,
  DeleteCredentialMessage,
  DeleteCredentialResponse,
  DiscardPendingCredentialMessage,
  DiscardPendingCredentialResponse,
  FillCredentialMessage,
  FillCredentialResponse,
  GetCredentialMessage,
  GetCredentialResponse,
  GetPendingCredentialMessage,
  GetPendingCredentialResponse,
  SaveCredentialMessage,
  SaveCredentialResponse,
} from '../../../shared/messages';
import { normalizeOrigin } from '../../../shared/origin';
import { updateBadgeForTab } from '../../badge';
import { detectLoginForm } from '../../firewall/loginDetector';
import { getSessionState } from '../../session/state';
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

// Phase 5 M5 -- reuses AUTOFILL_FIELDS (content/autofill.ts's existing
// native-setter mechanism, already proven for PersonalData fields in
// Phase 3) rather than inventing a second write-back message type.
// Targets the FIRST password-bearing form detectLoginForm recognizes on
// the page -- not gated to kind === 'login' specifically, unlike M4's
// automatic capture path: a person manually choosing to fill a specific
// saved credential is itself the confirmation that this is the right
// form, regardless of which side of the low-confidence login/signup
// heuristic it happens to fall on.
export async function handleFillCredential(
  message: FillCredentialMessage,
): Promise<FillCredentialResponse> {
  const { origin, tabId, credential } = message.payload;

  await assertTabShowsOrigin(tabId, origin, 'fill credential');

  if (credential.kind !== 'password') {
    // Nothing to autofill via a text value for a passkey -- out of scope
    // for this native-setter mechanism entirely.
    return { filled: false };
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const sessionState = await getSessionState();
  const forms = sessionState.originForms[normalizedOrigin]?.forms ?? [];

  for (const form of forms) {
    const detected = detectLoginForm(form);
    if (!detected) continue;

    const values: Record<string, string> = {};
    const passwordField = form.fields[detected.passwordFieldIndex];
    if (passwordField) {
      values[getFieldKey(passwordField, detected.passwordFieldIndex)] = credential.password;
    }
    if (detected.identifierFieldIndex !== null && credential.username !== null) {
      const identifierField = form.fields[detected.identifierFieldIndex];
      if (identifierField) {
        values[getFieldKey(identifierField, detected.identifierFieldIndex)] = credential.username;
      }
    }

    if (Object.keys(values).length === 0) continue;

    const autofillMessage: AutofillFieldsMessage = {
      type: 'AUTOFILL_FIELDS',
      payload: { formIndex: form.formIndex, values },
    };
    // content/autofill.ts's applyAutofill now reports back whether it
    // actually wrote anything -- checked here rather than assumed, since
    // a stale cached formIndex/fieldKey (the live page changed since this
    // form was detected) would otherwise silently report success with
    // nothing actually filled (a /code-review finding).
    const applied = await browser.tabs.sendMessage(tabId, autofillMessage);
    return { filled: applied === true };
  }

  return { filled: false };
}
