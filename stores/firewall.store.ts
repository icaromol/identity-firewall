// Popup-side Pinia store for Phase 3 M4/M5 -- the Identity Firewall's
// approval UI. Mirrors session.store.ts/vault.store.ts's established
// conventions: Options-API defineStore, explicit message construction,
// MessageResponse<T> handling, refetch-on-mount rather than persisting
// across popup opens (a popup is destroyed and recreated every time, see
// session.store.ts's own header comment).
//
// This is the first store to need the ACTIVE TAB's origin rather than a
// session-wide list -- browser.tabs.query({active:true, currentWindow:true})
// is a new capability for the popup, used both to know which origin's
// pending request to show and which tab to relay AUTOFILL_FIELDS to.
//
// Decisions are keyed by `${formIndex}:${fieldKey}` internally (fieldKey
// from shared/fieldKey.ts) rather than fieldKey alone -- two different
// forms on the same page could otherwise both have, say, an "email" field
// and silently share one decision. The formIndex prefix is stripped again
// before a single form's decisions are sent in SUBMIT_FIELD_DECISIONS,
// which is already scoped to one formIndex per call.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import { getFieldKey } from '../shared/fieldKey';
import type {
  ClassifiedForm,
  GetPendingRequestMessage,
  MessageResponse,
  PendingRequest,
  SetHighTrustOriginMessage,
  SetHighTrustOriginResponse,
  SubmitFieldDecisionsMessage,
  SubmitFieldDecisionsResponse,
} from '../shared/messages';
import type { PersonalDataFieldName, PolicyAction, ResponseType } from '../shared/vault-schema';
import { resolveActiveTab } from './shared/activeTab';

function compoundKey(formIndex: number, fieldKey: string): string {
  return `${formIndex}:${fieldKey}`;
}

export interface FirewallStoreState {
  origin: string | null;
  tabId: number | null;
  forms: ClassifiedForm[];
  availableResponses: Partial<Record<PersonalDataFieldName, ResponseType[]>>;
  // Phase 4 -- the Policy Engine's resolved action per fieldType, computed
  // server-side by background/firewall/handler.ts's handleGetPendingRequest
  // using the exact same resolvePolicy logic the automatic path uses.
  resolvedActions: Partial<Record<PersonalDataFieldName, PolicyAction>>;
  // Phase 4 M6 -- government/financial safe mode for THIS origin.
  isHighTrustOrigin: boolean;
  decisions: Record<string, ResponseType>; // keyed by compoundKey()
  // Tracks which decisions THIS store auto-filled from resolvedActions,
  // as opposed to ones the user picked by hand -- a /code-review finding:
  // refreshing resolvedActions after an unrelated action (toggling safe
  // mode) must only overwrite what it previously auto-filled, never a
  // manual choice, or the user's own picks silently vanish.
  autoFilledKeys: Set<string>;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  submittingFormIndex: number | null;
  // Keyed by formIndex, not a single shared field -- a /code-review
  // finding: a page can have more than one pending form, and a single
  // store-wide submitError would render the same error under every form's
  // card in the template even though only one of them actually failed.
  submitErrors: Record<number, string>;
  togglingHighTrust: boolean;
  highTrustError: string | null;
}

export const useFirewallStore = defineStore('firewall', {
  state: (): FirewallStoreState => ({
    origin: null,
    tabId: null,
    forms: [],
    availableResponses: {},
    resolvedActions: {},
    isHighTrustOrigin: false,
    decisions: {},
    autoFilledKeys: new Set(),
    status: 'idle',
    error: null,
    submittingFormIndex: null,
    submitErrors: {},
    togglingHighTrust: false,
    highTrustError: null,
  }),
  actions: {
    // Applies a fresh GET_PENDING_REQUEST response to state. Only clears
    // decisions this store itself auto-filled last time it ran (tracked
    // in autoFilledKeys) before re-populating from the new
    // resolvedActions -- any decision the user picked by hand survives a
    // refresh triggered by something unrelated (e.g. toggling safe mode).
    applyPendingRequestData(data: PendingRequest): void {
      // `?? {}`/`?? false` defend against a response missing a field the
      // TS type promises is always present -- the message channel itself
      // is untyped JSON and the response side isn't Zod-validated the way
      // requests are (see stores/session.store.ts's own comment on this),
      // so a version-skew or malformed response degrades gracefully here
      // instead of throwing partway through and landing in the generic
      // catch-block error state.
      this.forms = data.forms ?? [];
      this.availableResponses = data.availableResponses ?? {};
      this.resolvedActions = data.resolvedActions ?? {};
      this.isHighTrustOrigin = data.isHighTrustOrigin ?? false;

      for (const key of this.autoFilledKeys) delete this.decisions[key];
      this.autoFilledKeys = new Set();

      // Pre-fill every field whose Policy Engine resolution is anything
      // but 'ask' -- "only asks what falls outside the rules"
      // (privacy-model.md). A field resolving to 'ask' is left blank,
      // needing the user's own choice, exactly as Phase 3 always worked
      // before any policy existed.
      for (const form of this.forms) {
        form.fields.forEach((field, index) => {
          if (!field.fieldType) return;
          const resolved = this.resolvedActions[field.fieldType];
          if (resolved && resolved !== 'ask') {
            const key = compoundKey(form.formIndex, getFieldKey(field, index));
            this.decisions[key] = resolved;
            this.autoFilledKeys.add(key);
          }
        });
      }
    },

    async fetchPendingRequest(): Promise<void> {
      this.status = 'loading';
      this.error = null;
      // A fresh mount (or a genuinely new active tab) has no manual
      // decisions worth preserving from a different origin's session --
      // cleared explicitly here, unlike applyPendingRequestData's own
      // narrower auto-filled-only clearing used for same-origin refreshes.
      this.decisions = {};
      this.autoFilledKeys = new Set();

      try {
        const { tabId, origin } = await resolveActiveTab();
        this.tabId = tabId;
        this.origin = origin;

        const message: GetPendingRequestMessage = {
          type: 'GET_PENDING_REQUEST',
          payload: { origin: this.origin },
        };
        const response: MessageResponse<PendingRequest> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.applyPendingRequestData(response.data);
          this.status = 'loaded';
        } else {
          this.error = response.error;
          this.status = 'error';
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.status = 'error';
      }
    },

    // Government/financial safe mode (Phase 4 M6) -- marks/unmarks THIS
    // origin high-trust, then refreshes resolvedActions/decisions so the
    // effect (every field forced back to 'ask', overriding any stored
    // policy -- see resolvePolicy's own safe-mode-first ordering) is
    // visible immediately, without discarding any decision the user
    // already made by hand (applyPendingRequestData's own guarantee) or
    // re-querying the active tab a second time (tabId/origin don't change
    // just because safe mode toggled).
    async toggleHighTrust(): Promise<void> {
      if (this.origin === null || this.tabId === null || this.togglingHighTrust) return;

      this.togglingHighTrust = true;
      this.highTrustError = null;

      try {
        const setMessage: SetHighTrustOriginMessage = {
          type: 'SET_HIGH_TRUST_ORIGIN',
          payload: {
            origin: this.origin,
            tabId: this.tabId,
            isHighTrust: !this.isHighTrustOrigin,
          },
        };
        const setResponse: MessageResponse<SetHighTrustOriginResponse> =
          await browser.runtime.sendMessage(setMessage);
        if (!setResponse.ok) {
          this.highTrustError = setResponse.error;
          return;
        }

        const getMessage: GetPendingRequestMessage = {
          type: 'GET_PENDING_REQUEST',
          payload: { origin: this.origin },
        };
        const getResponse: MessageResponse<PendingRequest> =
          await browser.runtime.sendMessage(getMessage);
        if (getResponse.ok) {
          this.applyPendingRequestData(getResponse.data);
        } else {
          this.highTrustError = getResponse.error;
        }
      } catch (err) {
        this.highTrustError = err instanceof Error ? err.message : String(err);
      } finally {
        this.togglingHighTrust = false;
      }
    },

    getDecision(formIndex: number, fieldKey: string): ResponseType | undefined {
      return this.decisions[compoundKey(formIndex, fieldKey)];
    },

    setDecision(formIndex: number, fieldKey: string, responseType: ResponseType): void {
      this.decisions[compoundKey(formIndex, fieldKey)] = responseType;
    },

    // A manual quick-action for the fields the Policy Engine itself left
    // as 'ask' -- most apparently-optional fields never reach here at all
    // (resolvePolicy already defaults an optional field with no explicit
    // rule to 'deny'), but an explicit stored rule can still leave one at
    // 'ask' on purpose, and this lets the user clear those in one click
    // rather than one at a time. Leaves required fields exactly as they
    // are -- only touches fields apparentlyRequired === false.
    applyDenyOptional(): void {
      for (const form of this.forms) {
        form.fields.forEach((field, index) => {
          if (field.fieldType && !field.apparentlyRequired) {
            this.setDecision(form.formIndex, getFieldKey(field, index), 'deny');
          }
        });
      }
    },

    async submitForm(formIndex: number): Promise<void> {
      const form = this.forms.find((f) => f.formIndex === formIndex);
      if (!form || this.origin === null || this.tabId === null) return;

      this.submittingFormIndex = formIndex;
      delete this.submitErrors[formIndex];

      const decisions: Record<string, ResponseType> = {};
      form.fields.forEach((field, index) => {
        const key = getFieldKey(field, index);
        const decision = this.getDecision(formIndex, key);
        if (decision) decisions[key] = decision;
      });

      const message: SubmitFieldDecisionsMessage = {
        type: 'SUBMIT_FIELD_DECISIONS',
        payload: { origin: this.origin, tabId: this.tabId, formIndex, decisions },
      };

      try {
        const response: MessageResponse<SubmitFieldDecisionsResponse> =
          await browser.runtime.sendMessage(message);
        if (!response.ok) this.submitErrors[formIndex] = response.error;
      } catch (err) {
        this.submitErrors[formIndex] = err instanceof Error ? err.message : String(err);
      } finally {
        this.submittingFormIndex = null;
      }
    },
  },
});
