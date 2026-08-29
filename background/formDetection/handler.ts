import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';
import type { FormDetectedMessage } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { classifyForm } from '../firewall/classifier';
import { recordFormDetection } from '../session/state';

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

  // Toolbar badge is the "you have a pending request" signal design
  // decision 7 calls for, in place of an injected in-page overlay. Tab-
  // scoped (not global) via ctx.sender.tab -- the same MessageSender the
  // popup itself doesn't have, which is exactly why SUBMIT_FIELD_DECISIONS
  // has to carry its own tabId explicitly (see shared/messages.ts's own
  // comment on that).
  const tabId = ctx.sender.tab?.id;
  if (tabId !== undefined) {
    const recognizedFieldCount = classified.reduce(
      (total, form) => total + form.fields.filter((f) => f.fieldType !== null).length,
      0,
    );
    await browser.action.setBadgeText({
      tabId,
      text: recognizedFieldCount > 0 ? String(recognizedFieldCount) : '',
    });
  }

  return { recorded: true };
}
