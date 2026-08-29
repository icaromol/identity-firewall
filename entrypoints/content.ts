// Phase 1 content script. ISOLATED world only -- permanently, see
// docs/plans/phase-1-extension-foundation.md ("Resolved conflict") and
// ADR-011. Reports structure, not semantics: a single document_idle pass
// over document.forms, or nothing at all if the page has no forms. See
// content/formDetection.ts for the pure extraction logic this composes.
import { browser } from 'wxt/browser';
import { applyAutofill } from '../content/autofill';
import { buildFormDetectedMessage } from '../content/formDetection';
import type { MessageResponse } from '../shared/messages';
import { AutofillFieldsMessageSchema } from '../shared/messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    // AUTOFILL_FIELDS (Phase 3 M5) arrives via browser.tabs.sendMessage
    // from background, never through the FORM_DETECTED send below --
    // this is the content script's first-ever inbound listener. Validated
    // directly against its own schema, not the full ExtensionMessage
    // union, since this listener only ever expects the one message type.
    browser.runtime.onMessage.addListener((raw) => {
      const parsed = AutofillFieldsMessageSchema.safeParse(raw);
      if (!parsed.success) return; // not ours -- let another listener (if any) handle it
      applyAutofill(document, parsed.data);
    });

    const message = buildFormDetectedMessage(document, location.href, Date.now());
    if (!message) return;

    // Fire-and-forget: nothing in the content script can usefully retry
    // or surface a failed report to the page (Phase 1 does a single
    // document_idle pass, no re-detection -- see roadmap.md Phase 6).
    //
    // background/router/dispatch.ts is deliberately built to never
    // reject -- even a handler failure resolves as {ok:false, error}
    // (that's the fix for a real Attestto hung-promise bug, see its own
    // header comment) -- so .catch() below only ever catches a
    // transport-level failure (e.g. "Extension context invalidated"
    // after a dev-mode reload, or the background worker not yet awake),
    // never a handler-side one. Reading the resolved response is what
    // catches the latter; without it, a failure inside recordFormDetection
    // (e.g. browser.storage.session.set rejecting) would be silently
    // dropped with zero trace anywhere.
    browser.runtime
      .sendMessage(message)
      .then((response: MessageResponse) => {
        if (!response.ok) {
          // console.debug, not warn/error -- there's nothing actionable
          // for a user here, and M7's acceptance checklist requires no
          // console *errors* on a page with a form. This is purely so a
          // developer debugging locally can see the failure at all.
          console.debug('Identity Firewall: FORM_DETECTED was not recorded', response.error);
        }
      })
      .catch(() => {});
  },
});
