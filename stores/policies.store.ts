// Options-page-side Pinia store for Phase 7 Part A M5 -- the Personal
// Data tab's per-field default-policy dropdowns. Wraps GET_POLICIES/
// SET_POLICY/DELETE_POLICY (background/policy/), which have existed,
// fully working, since Phase 4 -- this store is the first thing that ever
// calls them from any UI. Global scope only ({kind:'global'}); a per-
// origin PolicyRule is a different, not-yet-built surface.

import { defineStore } from 'pinia';
import { browser } from 'wxt/browser';
import type {
  DeletePolicyMessage,
  DeletePolicyResponse,
  GetPoliciesMessage,
  GetPoliciesResponse,
  MessageResponse,
  SetPolicyMessage,
  SetPolicyResponse,
} from '../shared/messages';
import type {
  PersonalDataFieldName,
  PolicyAction,
  PolicyRule,
  ResponseType,
} from '../shared/vault-schema';

export interface PoliciesStoreState {
  policies: PolicyRule[];
  availableResponses: Record<PersonalDataFieldName, ResponseType[]>;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
  saving: boolean;
  saveError: string | null;
}

export const usePoliciesStore = defineStore('policies', {
  state: (): PoliciesStoreState => ({
    policies: [],
    availableResponses: {} as Record<PersonalDataFieldName, ResponseType[]>,
    status: 'idle',
    error: null,
    saving: false,
    saveError: null,
  }),
  actions: {
    async fetchPolicies(): Promise<void> {
      this.status = 'loading';
      this.error = null;

      const message: GetPoliciesMessage = { type: 'GET_POLICIES', payload: {} };

      try {
        const response: MessageResponse<GetPoliciesResponse> =
          await browser.runtime.sendMessage(message);
        if (response.ok) {
          this.policies = response.data.policies;
          this.availableResponses = response.data.availableResponses;
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

    // action === null means "clear the override, fall back to
    // PERSONAL_DATA_FIELD_DEFAULT_ACTION" -- the dropdown's own "Default"
    // option -- calling DELETE_POLICY rather than SET_POLICY with some
    // sentinel value, since 'ask' is itself a real, explicit PolicyAction
    // (distinct from "no rule at all, whatever the hardcoded default
    // happens to be").
    async setGlobalPolicy(
      fieldType: PersonalDataFieldName,
      action: PolicyAction | null,
    ): Promise<void> {
      this.saving = true;
      this.saveError = null;

      try {
        if (action === null) {
          const message: DeletePolicyMessage = {
            type: 'DELETE_POLICY',
            payload: { scope: { kind: 'global' }, fieldType },
          };
          const response: MessageResponse<DeletePolicyResponse> =
            await browser.runtime.sendMessage(message);
          if (response.ok) {
            this.policies = response.data;
          } else {
            this.saveError = response.error;
          }
        } else {
          const message: SetPolicyMessage = {
            type: 'SET_POLICY',
            payload: { scope: { kind: 'global' }, fieldType, action },
          };
          const response: MessageResponse<SetPolicyResponse> =
            await browser.runtime.sendMessage(message);
          if (response.ok) {
            this.policies = response.data;
          } else {
            this.saveError = response.error;
          }
        }
      } catch (err) {
        this.saveError = err instanceof Error ? err.message : String(err);
      } finally {
        this.saving = false;
      }
    },
  },
});
