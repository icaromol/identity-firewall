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
  SubmitFieldDecisionsMessage,
  SubmitFieldDecisionsResponse,
} from '../shared/messages';
import type { PersonalDataFieldName, PolicyAction, ResponseType } from '../shared/vault-schema';

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
  decisions: Record<string, ResponseType>; // keyed by compoundKey()
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  submittingFormIndex: number | null;
  // Keyed by formIndex, not a single shared field -- a /code-review
  // finding: a page can have more than one pending form, and a single
  // store-wide submitError would render the same error under every form's
  // card in the template even though only one of them actually failed.
  submitErrors: Record<number, string>;
}

export const useFirewallStore = defineStore('firewall', {
  state: (): FirewallStoreState => ({
    origin: null,
    tabId: null,
    forms: [],
    availableResponses: {},
    resolvedActions: {},
    decisions: {},
    status: 'idle',
    error: null,
    submittingFormIndex: null,
    submitErrors: {},
  }),
  actions: {
    async fetchPendingRequest(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url || tab.id === undefined) {
          this.error = 'Could not determine the active tab';
          this.status = 'error';
          return;
        }

        this.tabId = tab.id;
        this.origin = new URL(tab.url).origin;

        const message: GetPendingRequestMessage = {
          type: 'GET_PENDING_REQUEST',
          payload: { origin: this.origin },
        };
        const response: MessageResponse<PendingRequest | null> =
          await browser.runtime.sendMessage(message);

        if (response.ok) {
          this.forms = response.data?.forms ?? [];
          this.availableResponses = response.data?.availableResponses ?? {};
          this.resolvedActions = response.data?.resolvedActions ?? {};
          this.decisions = {};
          // Pre-fill every field whose Policy Engine resolution is
          // anything but 'ask' -- "only asks what falls outside the
          // rules" (privacy-model.md). A field resolving to 'ask' is left
          // blank, needing the user's own choice, exactly as Phase 3
          // always worked before any policy existed.
          for (const form of this.forms) {
            form.fields.forEach((field, index) => {
              if (!field.fieldType) return;
              const resolved = this.resolvedActions[field.fieldType];
              if (resolved && resolved !== 'ask') {
                this.decisions[compoundKey(form.formIndex, getFieldKey(field, index))] = resolved;
              }
            });
          }
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
