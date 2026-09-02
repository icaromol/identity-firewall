<script lang="ts" setup>
// M5 -- the real "sites detected this session" view, backed by
// stores/session.store.ts. M4 adds the Vault section's three real states
// (setup/locked/unlocked), backed by stores/vault.store.ts. Phase 3 M4/M5
// add the "Pending request" section below, backed by
// stores/firewall.store.ts -- the Identity Firewall's approval UI. Phase 4
// M5 adds "What this site knows about you", backed by
// stores/privacyLedger.store.ts. Phase 5 M1 added "Personal data" here,
// backed by stores/personalData.store.ts -- relocated to the Options page
// in Phase 6 M3 (docs/plans/phase-6-extension-dashboard.md), along with
// Export/Restore (Phase 6 M4) -- both are gone from this popup now.
// Phase 5 M4 adds "Save this login?", backed by
// stores/pendingCredential.store.ts -- a login captured on submit by the
// content script, staged in session state until confirmed here. Phase 5
// M5 adds "Saved logins", backed by stores/savedCredentials.store.ts --
// lists what's already saved for this site, plain (no masking -- see the
// plan's own decision), with a Fill action.
//
// UI-quality pass: every input/button/section wrapper now goes through
// components/ui/ -- previously every one of these was a hand-copied class
// string, repeated (and occasionally drifting) at every call site. Toasts
// (stores/shared/toast.store.ts) now confirm actions that used to give the
// user zero feedback at all (Safe Mode toggle, Deny optional fields,
// Submit, credential Confirm/Discard/Fill) -- reserved for transient,
// already-succeeded confirmations; an error a user needs to actually read
// stays inline near its control, unchanged from before.
// Every icon here is a real component reference -- either returned
// directly from vaultStatusIcon below (a genuine script-level use Biome
// already sees fine on its own) or passed as a template binding
// (:icon="Bell", <Check />, etc.), which Biome's <script>-only lint pass
// can't see, hence the blanket ignore below for the whole import.
// biome-ignore-start lint/correctness/noUnusedImports: used in <template> -- Biome only lints the <script> block, it can't see template usage.
import {
  Bell,
  Check,
  Globe,
  Key,
  KeyRound,
  Lock,
  LockOpen,
  Save,
  ScrollText,
  Shield,
  TriangleAlert,
  X,
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import UiButton from '../../components/ui/UiButton.vue';
import UiSection from '../../components/ui/UiSection.vue';
import UiSpinner from '../../components/ui/UiSpinner.vue';
import UiTextInput from '../../components/ui/UiTextInput.vue';
import UiToastHost from '../../components/ui/UiToastHost.vue';
// biome-ignore-end lint/correctness/noUnusedImports: used in <template>
import { getFieldKey } from '../../shared/fieldKey';
import type { ClassifiedField, ClassifiedForm } from '../../shared/messages';
import type { CredentialRecord, ResponseType } from '../../shared/vault-schema';
import { useFirewallStore } from '../../stores/firewall.store';
import { usePendingCredentialStore } from '../../stores/pendingCredential.store';
import { usePrivacyLedgerStore } from '../../stores/privacyLedger.store';
import { useSavedCredentialsStore } from '../../stores/savedCredentials.store';
import { useSessionStore } from '../../stores/session.store';
import { summarizeLedgerEntries } from '../../stores/shared/ledgerSummary';
import { useToastStore } from '../../stores/shared/toast.store';
import { useVaultStore } from '../../stores/vault.store';

const session = useSessionStore();
const vault = useVaultStore();
const firewall = useFirewallStore();
const privacyLedger = usePrivacyLedgerStore();
const pendingCredential = usePendingCredentialStore();
const savedCredentials = useSavedCredentialsStore();
const toast = useToastStore();

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const ledgerSummary = computed(() => summarizeLedgerEntries(privacyLedger.entries));

// The active tab's origin, shown ONCE above the site-scoped sections below
// instead of repeated in every one of their own titles (a real complaint:
// the same domain was appearing 3-4 times on screen at once). Reads only
// firewall.origin, not an OR-chain across all four site-scoped stores --
// each independently calls the identical resolveActiveTab()
// (stores/shared/activeTab.ts) and sets its own `origin` the moment tab
// resolution succeeds, before its own backend call even runs, so
// firewall.origin is populated in every case any of the others would be
// too. A /code-review finding caught the OR-chain version of this: since
// none of the four stores ever reset `origin` back to null on a LATER
// failed refetch, falling back across stores could keep showing a stale
// domain from whichever one last succeeded, right above a section
// correctly reporting "could not determine the active tab" -- reading a
// single store sidesteps that entirely.
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const currentOrigin = computed(() => firewall.origin);

// A persistent, at-a-glance vault-state icon in the header -- independent
// of the Vault section's own detailed cards below, which a user shouldn't
// have to scroll to just to know "am I locked right now?" No overlapping
// label text: the Vault section below already owns the literal strings
// "Vault unlocked."/"Vault is locked." (which tests/e2e/vaultLifecycle.test.ts
// and others assert on), and Playwright's non-exact getByText matches
// substrings -- a second element repeating that same text would trip a
// strict-mode "resolved to 2 elements" violation (the exact class of bug
// Phase 6's v-show/v-if fix caught).
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const vaultStatusIcon = computed(() => {
  if (vault.status !== 'loaded') return null;
  if (!vault.initialized) return KeyRound;
  return vault.locked ? Lock : LockOpen;
});

const setupPassphrase = ref('');
const unlockPassphrase = ref('');

// Every section scoped to the vault's own contents (as opposed to
// vault.store.ts's own status) needs re-fetching both on mount AND right
// after a successful setup/unlock -- each of those stores only fetches
// once by itself (session.store.ts's own established convention), so
// unlocking mid-popup-session previously left them stuck showing
// VAULT_LOCKED until the popup was closed and reopened (a real usability
// gap found during Phase 5 M7's manual verification, not just the
// narrower personalData-only case M1's own e2e test already flagged).
function refreshVaultScopedSections(): void {
  session.fetchSessionState();
  firewall.fetchPendingRequest();
  privacyLedger.fetchLedger();
  pendingCredential.fetchPendingCredential();
  savedCredentials.fetchCredentials();
}

onMounted(() => {
  vault.fetchStatus();
  refreshVaultScopedSections();
});

// Preserves each field's true index within form.fields (needed for
// getFieldKey's positional fallback) while still letting the template
// skip unmanaged fields (fieldType === null) -- a plain template
// v-for + v-if on the same element isn't allowed in Vue 3, and filtering
// form.fields directly would renumber the survivors, breaking that
// fallback for any field identified by position rather than name/id.
// biome-ignore lint/correctness/noUnusedVariables: called from <template>'s v-for -- Biome only lints the <script> block, it can't see template usage.
function fieldEntries(form: ClassifiedForm): { field: ClassifiedField; key: string }[] {
  return form.fields
    .map((field, index) => ({ field, key: getFieldKey(field, index) }))
    .filter((entry) => entry.field.fieldType !== null);
}

// biome-ignore lint/correctness/noUnusedVariables: called from @change in <template> -- Biome only lints the <script> block, it can't see template usage.
function onDecisionChange(formIndex: number, fieldKey: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value) firewall.setDecision(formIndex, fieldKey, value as ResponseType);
}

// biome-ignore lint/correctness/noUnusedVariables: called from @change in <template> -- Biome only lints the <script> block, it can't see template usage.
async function toggleHighTrust(): Promise<void> {
  // Mirrors the store's own re-entrancy guard (toggleHighTrust's early
  // `if (... this.togglingHighTrust) return;`) -- without duplicating it
  // here, a double-click racing ahead of the checkbox's own :disabled
  // re-render would let a second, short-circuited call fall through to
  // the check below and fire a false "Safe mode enabled." toast for a
  // click that changed nothing (a /code-review finding).
  if (firewall.togglingHighTrust) return;
  const wasHighTrust = firewall.isHighTrustOrigin;
  await firewall.toggleHighTrust();
  if (!firewall.highTrustError && firewall.isHighTrustOrigin !== wasHighTrust) {
    toast.push(
      firewall.isHighTrustOrigin
        ? 'Safe mode enabled for this site.'
        : 'Safe mode disabled for this site.',
      'success',
    );
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
function clickDenyOptional(): void {
  // Only toast when something was actually touched -- a form with no
  // optional fields at all would otherwise get a "Denied all optional
  // fields." confirmation for a click that changed nothing (a
  // /code-review finding).
  const count = firewall.applyDenyOptional();
  if (count > 0) toast.push('Denied all optional fields.', 'success');
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickSubmitForm(formIndex: number): Promise<void> {
  // submitForm's own boolean return, not "no error" -- a stale formIndex
  // (this.forms reassigned by an unrelated refresh in-flight at the same
  // time) makes submitForm early-return without ever touching
  // submitErrors, which "no error" would otherwise misread as success
  // (a /code-review finding).
  const applied = await firewall.submitForm(formIndex);
  if (applied) {
    toast.push('Applied.', 'success');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickConfirmCredential(): Promise<void> {
  // Mirrors confirm()'s own `if (... this.confirming) return;` guard --
  // see toggleHighTrust's comment above for why this duplication matters.
  if (pendingCredential.confirming) return;
  await pendingCredential.confirm();
  if (!pendingCredential.actionError) {
    toast.push('Login saved.', 'success');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickDiscardCredential(): Promise<void> {
  if (pendingCredential.discarding) return;
  await pendingCredential.discard();
  if (!pendingCredential.actionError) {
    toast.push('Discarded.', 'info');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickFillCredential(credential: CredentialRecord) {
  if (savedCredentials.filling !== null) return;
  await savedCredentials.fill(credential);
  if (!savedCredentials.fillError) {
    toast.push('Filled.', 'success');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickSetupWithPasskey() {
  await vault.setupWithPasskey();
  if (!vault.locked) refreshVaultScopedSections();
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitSetupPassphrase() {
  await vault.setupWithPassphrase(setupPassphrase.value);
  setupPassphrase.value = '';
  if (!vault.locked) refreshVaultScopedSections();
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickUnlockWithPasskey() {
  await vault.unlockWithPasskey();
  if (!vault.locked) refreshVaultScopedSections();
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitUnlockPassphrase() {
  await vault.unlockWithPassphrase(unlockPassphrase.value);
  unlockPassphrase.value = '';
  if (!vault.locked) refreshVaultScopedSections();
}
</script>

<template>
  <main class="p-4 text-sm text-neutral-100 bg-neutral-900">
    <UiToastHost />

    <div class="flex items-center justify-between">
      <h1 class="flex items-center gap-1.5 text-base font-semibold">
        <Shield class="h-4 w-4" aria-hidden="true" /> Identity Firewall
      </h1>
      <span
        v-if="vaultStatusIcon"
        :title="
          !vault.initialized
            ? 'Vault not set up'
            : vault.locked
              ? 'Vault is locked'
              : 'Vault is unlocked'
        "
      >
        <component :is="vaultStatusIcon" class="h-4 w-4 text-neutral-400" aria-hidden="true" />
      </span>
    </div>

    <UiSection title="Vault" :icon="Key" :divider="false">
      <p class="mt-1 text-xs text-neutral-500">
        Personal data and backup/recovery have moved to the extension's Dashboard page
        (right-click the extension icon → Options).
      </p>

      <p v-if="vault.status === 'error'" class="mt-2 text-red-400">{{ vault.error }}</p>

      <!-- 'idle' (fetchStatus hasn't resolved yet) gets its own branch --
           otherwise vault.store.ts's default state (initialized:false)
           would flash "set up your vault" on every popup open, even for an
           already-set-up vault, until the async VAULT_STATUS reply lands. -->
      <p v-if="vault.status === 'idle'" class="mt-2 flex items-center gap-2 text-neutral-400">
        <UiSpinner size="sm" /> Loading…
      </p>

      <!-- No vault yet: setup. Checked before `locked` -- a brand-new,
           uninitialized vault also reports locked:true, so checking `locked`
           first would show "please unlock" instead of "please set up". -->
      <div v-else-if="!vault.initialized" class="mt-2 space-y-3">
        <p class="text-neutral-400">Set up your vault to get started.</p>

        <UiButton :loading="vault.status === 'loading'" @click="clickSetupWithPasskey()">
          Set up with Passkey (recommended)
        </UiButton>
        <p class="text-xs text-neutral-500">
          Uses your device's biometric or security key. Recommended over a passphrase -- see
          ADR-012.
        </p>

        <form class="space-y-2" @submit.prevent="submitSetupPassphrase">
          <UiTextInput
            v-model="setupPassphrase"
            type="password"
            placeholder="Or choose a passphrase instead"
          />
          <UiButton
            type="submit"
            variant="secondary"
            :disabled="setupPassphrase.length === 0"
            :loading="vault.status === 'loading'"
          >
            Set up with Passphrase
          </UiButton>
        </form>
      </div>

      <!-- Initialized but locked: unlock form, keyed off which method this
           vault was actually configured with. undefined -> show both,
           graceful degradation rather than an error. The passkey button
           additionally requires passkeyCredentialId to actually be present
           (not just configuredUnlockMethod === 'passkey') -- defense in
           depth against the case where that pairing was ever only
           partially persisted; the passphrase form is shown whenever the
           passkey button ISN'T fully usable, so the user is never left
           with zero visible way to unlock. -->
      <div v-else-if="vault.locked" class="mt-2 space-y-3">
        <p class="text-neutral-400">Vault is locked.</p>

        <UiButton
          v-if="
            vault.configuredUnlockMethod === undefined ||
            (vault.configuredUnlockMethod === 'passkey' && vault.passkeyCredentialId)
          "
          :loading="vault.status === 'loading'"
          @click="clickUnlockWithPasskey()"
        >
          Unlock with Passkey
        </UiButton>

        <form
          v-if="
            vault.configuredUnlockMethod === undefined ||
            vault.configuredUnlockMethod === 'passphrase' ||
            (vault.configuredUnlockMethod === 'passkey' && !vault.passkeyCredentialId)
          "
          class="space-y-2"
          @submit.prevent="submitUnlockPassphrase"
        >
          <UiTextInput v-model="unlockPassphrase" type="password" placeholder="Passphrase" />
          <UiButton
            type="submit"
            variant="secondary"
            :disabled="unlockPassphrase.length === 0"
            :loading="vault.status === 'loading'"
          >
            Unlock with Passphrase
          </UiButton>
        </form>
      </div>

      <!-- Unlocked. Per decision 6, nothing about vault CONTENTS is shown
           here -- just the fact that it's unlocked. Export/Restore moved to
           the Options page (Phase 6 M4) -- see this section's own header
           note above. -->
      <div v-else class="mt-2 space-y-3">
        <p class="text-green-400">Vault unlocked.</p>
        <UiButton
          :block="false"
          variant="secondary"
          :loading="vault.status === 'loading'"
          @click="vault.lock()"
        >
          Lock
        </UiButton>
      </div>
    </UiSection>

    <!-- The site every section below is scoped to, shown once here rather
         than repeated in each of their own titles. -->
    <p v-if="currentOrigin" class="mt-4 truncate text-xs text-neutral-500">
      {{ currentOrigin }}
    </p>

    <!-- The header icon already gives an at-a-glance lock state; the four
         sections below are about a SPECIFIC SITE, so none of them are
         meaningful until the vault actually holds something to disclose.
         'VAULT_LOCKED' is specifically softened here (a muted note, not a
         red error) since it's an expected, common state, not a failure --
         any OTHER error (e.g. the tab-resolution failure
         tests/e2e/firewallApproval.test.ts exercises) still renders in the
         normal red-error style below, unchanged. -->
    <UiSection
      title="Pending request"
      :icon="Bell"
      :class="firewall.forms.length > 0 ? 'border-l-2 border-amber-500/60 pl-2 -ml-2' : ''"
    >
      <!-- Government/financial safe mode (Phase 4 M6) -- a standing
           per-site setting, shown whenever the origin is known regardless
           of whether a request happens to be pending right now. -->
      <label
        v-if="firewall.origin"
        class="mt-2 flex items-center gap-2 text-xs text-neutral-400"
      >
        <input
          type="checkbox"
          :checked="firewall.isHighTrustOrigin"
          :disabled="firewall.togglingHighTrust"
          @change="toggleHighTrust()"
        />
        Treat this site as government/financial (always ask, ignore policies)
      </label>

      <p v-if="firewall.highTrustError" class="mt-1 text-xs text-red-400">
        {{ firewall.highTrustError }}
      </p>

      <p v-if="firewall.isHighTrustOrigin" class="mt-2 flex items-start gap-1.5 text-amber-400">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        This site has been identified as a government/financial service. Automatic identity
        autofill has been disabled.
      </p>

      <p
        v-if="firewall.status === 'idle' || firewall.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-neutral-400"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p
        v-else-if="firewall.status === 'error' && firewall.error === 'VAULT_LOCKED'"
        class="mt-2 text-neutral-500"
      >
        Set up your vault above to see this.
      </p>

      <p v-else-if="firewall.status === 'error'" class="mt-2 text-red-400">
        Could not load pending request: {{ firewall.error }}
      </p>

      <!-- Requires PersonalData, which requires an unlocked vault --
           handleGetPendingRequest throws VaultLockedError otherwise,
           surfaced here as a plain error string rather than a crash. -->
      <p v-else-if="firewall.forms.length === 0" class="mt-2 text-neutral-400">
        Nothing pending for this tab.
      </p>

      <!-- No "Approve all" button -- Phase 4's Policy Engine pre-fills
           every field it can resolve automatically the moment this list
           loads (fetchPendingRequest); a field the engine itself left at
           'ask' still gets a starting selection below -- 'deny', the most
           privacy-preserving option -- rather than a blank "Choose…"
           picker (stores/firewall.store.ts's applyPendingRequestData).
           The user still sees and can change it before Submit. -->
      <div v-else class="mt-2 space-y-4">
        <div class="flex gap-2">
          <UiButton variant="secondary" size="sm" :block="false" @click="clickDenyOptional()">
            Deny optional fields
          </UiButton>
        </div>

        <div
          v-for="form in firewall.forms"
          :key="form.formIndex"
          class="space-y-2 rounded border border-neutral-800 p-2"
        >
          <ul class="space-y-1">
            <li
              v-for="entry in fieldEntries(form)"
              :key="entry.key"
              class="flex items-center justify-between gap-2"
            >
              <div>
                <span>{{ entry.field.fieldType }}</span>
                <span class="ml-1 text-xs text-neutral-500">{{ entry.field.sensitivity }}</span>
                <span v-if="!entry.field.apparentlyRequired" class="ml-1 text-xs text-neutral-500"
                  >(optional)</span
                >
              </div>
              <select
                class="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-100"
                :value="firewall.getDecision(form.formIndex, entry.key) ?? ''"
                @change="onDecisionChange(form.formIndex, entry.key, $event)"
              >
                <option value="" disabled>Choose…</option>
                <option
                  v-for="r in firewall.availableResponses[entry.field.fieldType!] ?? []"
                  :key="r"
                  :value="r"
                >
                  {{ r }}
                </option>
              </select>
            </li>
          </ul>

          <UiButton
            :loading="firewall.submittingFormIndex === form.formIndex"
            @click="clickSubmitForm(form.formIndex)"
          >
            Submit
          </UiButton>
          <p v-if="firewall.submitErrors[form.formIndex]" class="text-xs text-red-400">
            {{ firewall.submitErrors[form.formIndex] }}
          </p>
        </div>
      </div>
    </UiSection>

    <UiSection
      v-if="pendingCredential.pending"
      title="Save this login?"
      :icon="Save"
      class="border-l-2 border-amber-500/60 pl-2 -ml-2"
    >
      <div class="mt-2 space-y-2">
        <p class="text-neutral-300">
          {{ pendingCredential.pending.identifier ?? '(no username/email detected)' }}
        </p>
        <input
          :value="pendingCredential.pending.password"
          type="password"
          readonly
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <div class="flex gap-2">
          <UiButton
            class="flex-1"
            :block="false"
            :loading="pendingCredential.confirming"
            @click="clickConfirmCredential()"
          >
            Save
          </UiButton>
          <UiButton
            class="flex-1"
            :block="false"
            variant="secondary"
            :loading="pendingCredential.discarding"
            @click="clickDiscardCredential()"
          >
            Discard
          </UiButton>
        </div>
        <p v-if="pendingCredential.actionError" class="text-xs text-red-400">
          {{ pendingCredential.actionError }}
        </p>
      </div>
    </UiSection>

    <UiSection
      title="Saved logins"
      :icon="KeyRound"
    >
      <p
        v-if="savedCredentials.status === 'idle' || savedCredentials.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-neutral-400"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p
        v-else-if="savedCredentials.status === 'error' && savedCredentials.error === 'VAULT_LOCKED'"
        class="mt-2 text-neutral-500"
      >
        Set up your vault above to see this.
      </p>

      <p v-else-if="savedCredentials.status === 'error'" class="mt-2 text-red-400">
        {{ savedCredentials.error }}
      </p>

      <p v-else-if="savedCredentials.credentials.length === 0" class="mt-2 text-neutral-400">
        Nothing saved for this site yet.
      </p>

      <div v-else class="mt-2 space-y-2">
        <ul class="space-y-2">
          <li
            v-for="credential in savedCredentials.credentials"
            :key="credential.kind"
            class="space-y-1 rounded border border-neutral-800 p-2"
          >
            <template v-if="credential.kind === 'password'">
              <p class="text-neutral-300">{{ credential.username ?? '(no username)' }}</p>
              <!-- type="text", not "password" -- decision 3 (the plan)
                   requires this list to show what's saved plainly, no
                   masking; that's Phase 8's job, once there's a proper
                   in-page reveal-preview to build instead. -->
              <input
                :value="credential.password"
                type="text"
                readonly
                class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
              />
              <UiButton
                variant="secondary"
                :loading="savedCredentials.filling === credential"
                @click="clickFillCredential(credential)"
              >
                Fill
              </UiButton>
            </template>
            <p v-else class="text-neutral-400">Passkey (not fillable this way)</p>
          </li>
        </ul>
        <p v-if="savedCredentials.fillError" class="text-xs text-red-400">
          {{ savedCredentials.fillError }}
        </p>
      </div>
    </UiSection>

    <UiSection
      title="What this site knows about you"
      :icon="ScrollText"
    >
      <p
        v-if="privacyLedger.status === 'idle' || privacyLedger.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-neutral-400"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p
        v-else-if="privacyLedger.status === 'error' && privacyLedger.error === 'VAULT_LOCKED'"
        class="mt-2 text-neutral-500"
      >
        Set up your vault above to see this.
      </p>

      <p v-else-if="privacyLedger.status === 'error'" class="mt-2 text-red-400">
        {{ privacyLedger.error }}
      </p>

      <p
        v-else-if="ledgerSummary.disclosed.size === 0 && ledgerSummary.denied.size === 0"
        class="mt-2 text-neutral-400"
      >
        No history for this site yet.
      </p>

      <div v-else class="mt-2 space-y-1">
        <p v-for="[field, responseType] in ledgerSummary.disclosed" :key="`d-${field}`" class="flex items-center gap-1.5">
          <Check class="h-3.5 w-3.5 text-green-400" aria-hidden="true" /> {{ field }}
          <span class="text-neutral-500">({{ responseType }})</span>
        </p>
        <p v-for="field in ledgerSummary.denied" :key="`x-${field}`" class="flex items-center gap-1.5">
          <X class="h-3.5 w-3.5 text-red-400" aria-hidden="true" /> {{ field }}
        </p>
        <p v-if="ledgerSummary.lastAccess" class="mt-2 text-xs text-neutral-500">
          Last access: {{ new Date(ledgerSummary.lastAccess).toLocaleString() }}
        </p>
      </div>
    </UiSection>

    <!-- Session-wide activity log, not scoped to any one site -- the
         least actionable section here, so it's last and visually quieter
         (opacity, no icon-matched accent) rather than competing for the
         same attention as the decision-needed sections above. -->
    <UiSection title="Sites detected this session" :icon="Globe" class="opacity-70">
      <!-- 'idle' (fetch hasn't run/completed yet) shares this branch with
           'loading', rather than falling through to the final v-else --
           otherwise a broken onMounted wiring would render identically to
           a genuinely empty session instead of visibly doing nothing. -->
      <p
        v-if="session.status === 'idle' || session.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-neutral-400"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="session.status === 'error'" class="mt-2 text-red-400">
        Could not load session state: {{ session.error }}
      </p>

      <ul v-else-if="session.originsWithForms.length > 0" class="mt-2 space-y-1">
        <li
          v-for="entry in session.originsWithForms"
          :key="entry.origin"
          class="flex items-center justify-between"
        >
          <span>{{ entry.origin }}</span>
          <span class="text-neutral-400">{{ entry.formCount }} form(s)</span>
        </li>
      </ul>

      <p v-else class="mt-2 text-neutral-400">No forms detected yet this session.</p>
    </UiSection>
  </main>
</template>
