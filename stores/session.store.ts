// Popup-side Pinia store for M5. A popup is destroyed and recreated on
// every open (MV3 popups have no persistent JS context to resume), so
// this store simply refetches from background on every mount -- there is
// no "does Pinia state survive popup close" problem to solve here. (A
// generic version of that problem exists for a *later* phase that holds
// popup-local UI state across opens -- see
// docs/plans/phase-1-extension-foundation.md's "Open questions".)
//
// Never reads browser.storage directly -- only talks to background over
// the M3 message router (shared/messages.ts), so background stays the
// single writer of session state and this store is a pure read-through
// view. The response shape (OriginSummary) is imported from
// shared/messages.ts -- the same type background/session/handler.ts's
// handleGetSessionState returns -- rather than each side declaring its
// own copy, per a /code-review finding on this milestone.
//
// Lives at the top level, a sibling of entrypoints/, background/,
// content/, shared/ -- not nested under entrypoints/popup/ -- mirroring
// the M4 precedent of keeping entrypoints/*.ts as thin composition roots
// and putting anything testable in a plain module a Vitest test can
// import directly (see content/formDetection.ts's own header comment).

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type { GetSessionStateMessage, MessageResponse, OriginSummary } from '../shared/messages';

export interface SessionStoreState {
  originsWithForms: OriginSummary[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

export const useSessionStore = defineStore('session', {
  state: (): SessionStoreState => ({
    originsWithForms: [],
    status: 'idle',
    error: null,
  }),
  actions: {
    async fetchSessionState(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetSessionStateMessage = { type: 'GET_SESSION_STATE' };

      try {
        const response: MessageResponse<{ originsWithForms: OriginSummary[] }> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          // Defensive: the response side of this channel isn't
          // Zod-validated the way requests are (see dispatch.ts), so a
          // future shape drift between handler.ts and this store would
          // otherwise crash App.vue's render (`.length` on `undefined`)
          // instead of falling into the error state below.
          this.originsWithForms = Array.isArray(response.data?.originsWithForms)
            ? response.data.originsWithForms
            : [];
          this.status = 'loaded';
        } else {
          // A handler-level failure -- background/router/dispatch.ts is
          // deliberately built to never reject (see its own header
          // comment), so this branch is the { ok: false, error } reply
          // path, not a transport failure.
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        // Transport-level failure -- e.g. "Extension context invalidated"
        // after a dev-mode reload, or the background worker not yet
        // awake. entrypoints/content.ts draws this same distinction (see
        // its own comment) but has no UI to surface it in, so it swallows
        // it silently; the popup does have a UI (the error branch in
        // App.vue's template), so it's surfaced through the same
        // status/error fields the { ok: false } path above uses.
        // String(err), not a generic fallback message -- matches
        // background/router/dispatch.ts's own handling of a non-Error
        // rejection, preserving whatever diagnostic info it carries.
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },
  },
});
