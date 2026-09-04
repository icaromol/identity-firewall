// Phase 1 content script. ISOLATED world only -- permanently, see
// docs/plans/phase-1-extension-foundation.md ("Resolved conflict") and
// ADR-011. Reports structure, not semantics: a single document_idle pass
// over document.forms, or nothing at all if the page has no forms. See
// content/formDetection.ts for the pure extraction logic this composes.
import { browser } from 'wxt/browser';
import { applyAutofill } from '../content/autofill';
import { buildFormDetectedMessage, buildFormSubmittedMessage } from '../content/formDetection';
import { reportLog } from '../content/log';
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
    //
    // Replies with applyAutofill's own boolean result via the classic
    // sendResponse callback (mirroring background/router/dispatch.ts's own
    // convention) -- Phase 3's automatic/manual paths never read this
    // reply, but Phase 5 M5's manual Fill action does, since a stale
    // cached form/field would otherwise silently report success with
    // nothing actually filled (a /code-review finding).
    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const parsed = AutofillFieldsMessageSchema.safeParse(raw);
      if (!parsed.success) return false; // not ours -- let another listener (if any) handle it
      sendResponse(applyAutofill(document, parsed.data));
      return true;
    });

    const message = buildFormDetectedMessage(document, location.href, Date.now());
    if (message) {
      reportLog('info', 'Identity Firewall: content script reported a form detection', {
        origin: location.origin,
        formCount: message.payload.forms.length,
      });
      // Fire-and-forget: nothing in the content script can usefully retry
      // or surface a failed report to the page (Phase 1 does a single
      // document_idle pass, no re-detection -- see roadmap.md Phase 9).
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
    }

    // Phase 5 M4 -- capture-phase listener on the document, not a
    // per-form listener attached at document_idle: a form injected after
    // that one-shot pass (a login modal opened via JS, say) would
    // otherwise never be observed at all. Capture phase specifically so
    // this still fires even if the page's own submit handler calls
    // stopPropagation() during bubbling. Known, accepted limitation
    // (same category as Phase 4 M7's SPA-detection gap): a page that
    // intercepts submission via a plain button's onClick and never
    // dispatches a real 'submit' event at all (common in some SPAs) is
    // invisible to this listener -- there is no DOM signal to observe in
    // that case.
    document.addEventListener(
      'submit',
      (event) => {
        if (!(event.target instanceof HTMLFormElement)) return;
        const formIndex = Array.from(document.forms).indexOf(event.target);
        if (formIndex === -1) return;

        const submittedMessage = buildFormSubmittedMessage(event.target, formIndex, location.href);
        if (!submittedMessage) return; // no password field -- nothing this module cares about

        // Builds its OWN detail object -- never passes submittedMessage.payload
        // through, which carries the real typed password/identifier values.
        reportLog('info', 'Identity Firewall: content script reported a form submission', {
          formIndex,
        });
        browser.runtime.sendMessage(submittedMessage).catch(() => {});
      },
      { capture: true },
    );
  },
});
