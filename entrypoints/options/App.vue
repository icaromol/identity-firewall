<script lang="ts" setup>
// Phase 6 M1-M4 -- the extension's first UI surface that isn't the popup.
// A separate WXT entrypoint means a separate JS execution context and a
// separate Pinia instance from entrypoints/popup/App.vue -- nothing here
// inherits state the popup already fetched; every store below fetches its
// own data independently, the same "self-contained, independently
// testable stores" convention the popup's own stores already follow.
//
// UI-quality pass: inputs/buttons now go through components/ui/, matching
// the popup's own refactor. Toasts (stores/shared/toast.store.ts) confirm
// Save/Export/Restore, all of which gave no feedback (or, for Save, only
// a small inline line easy to miss) before -- reserved for transient
// success confirmations; an error a user needs to actually read stays
// inline near its own control, unchanged.
// DatabaseBackup/ScrollText/UserRound are referenced directly below (the
// TABS array), a real script-level use Biome sees fine on its own. Every
// other icon here (and every UI component below) is only ever used as a
// template binding, which Biome's <script>-only lint pass can't see,
// hence the blanket ignore for this whole import block.
// biome-ignore-start lint/correctness/noUnusedImports: used in <template> -- Biome only lints the <script> block, it can't see template usage.
import { Check, DatabaseBackup, ScrollText, Settings, Shield, UserRound, X } from '@lucide/vue';
import { computed, onMounted, reactive, ref } from 'vue';
import UiButton from '../../components/ui/UiButton.vue';
import UiSpinner from '../../components/ui/UiSpinner.vue';
import UiTextInput from '../../components/ui/UiTextInput.vue';
import UiToastHost from '../../components/ui/UiToastHost.vue';
import UiToggle from '../../components/ui/UiToggle.vue';
import UiTooltip from '../../components/ui/UiTooltip.vue';
// biome-ignore-end lint/correctness/noUnusedImports: used in <template>
import { isAutoLockDisabled } from '../../shared/settings';
import type {
  PersonalData,
  PersonalDataFieldName,
  PolicyAction,
  PrivacyLedgerEntry,
} from '../../shared/vault-schema';
import { PERSONAL_DATA_FIELD_DEFAULT_ACTION } from '../../shared/vault-schema';
import { useAllSitesLedgerStore } from '../../stores/allSitesLedger.store';
import { useAppSettingsStore } from '../../stores/appSettings.store';
import { usePersonalDataStore } from '../../stores/personalData.store';
import { usePoliciesStore } from '../../stores/policies.store';
import { type LedgerSummary, summarizeLedgerEntries } from '../../stores/shared/ledgerSummary';
import { useToastStore } from '../../stores/shared/toast.store';
import { useVaultStore } from '../../stores/vault.store';

const allSitesLedger = useAllSitesLedgerStore();
const personalData = usePersonalDataStore();
const vault = useVaultStore();
const toast = useToastStore();
const appSettings = useAppSettingsStore();
const policies = usePoliciesStore();

type Tab = 'ledger' | 'personalData' | 'backup' | 'configuration';
// biome-ignore lint/correctness/noUnusedVariables: read/written from <template> -- Biome only lints the <script> block, it can't see template usage.
const activeTab = ref<Tab>('ledger');

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const TABS: { value: Tab; label: string; icon: typeof ScrollText }[] = [
  { value: 'ledger', label: 'Who knows what about me', icon: ScrollText },
  { value: 'personalData', label: 'Personal data', icon: UserRound },
  { value: 'backup', label: 'Backup & recovery', icon: DatabaseBackup },
  { value: 'configuration', label: 'Configuration', icon: Settings },
];

// Per-origin version of entrypoints/popup/App.vue's own ledgerSummary
// computed -- both call the same stores/shared/ledgerSummary.ts helper
// (extracted after a /code-review finding caught this logic duplicated
// between the two components), just grouped by entry.origin first here
// since this tab has no single active tab to scope to. Only origins with
// at least one recorded entry appear (decision 6 in
// docs/plans/phase-6-extension-dashboard.md) -- an origin with a Service
// Identity but no disclosure/denial history yet is out of scope for this
// tab.
interface SiteSummary extends LedgerSummary {
  origin: string;
}

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const siteSummaries = computed<SiteSummary[]>(() => {
  const byOrigin = new Map<string, PrivacyLedgerEntry[]>();
  for (const entry of allSitesLedger.entries) {
    const list = byOrigin.get(entry.origin);
    if (list) {
      list.push(entry);
    } else {
      byOrigin.set(entry.origin, [entry]);
    }
  }

  const summaries: SiteSummary[] = [];
  for (const [origin, entries] of byOrigin) {
    summaries.push({ origin, ...summarizeLedgerEntries(entries) });
  }

  return summaries.sort((a, b) => (b.lastAccess ?? 0) - (a.lastAccess ?? 0));
});

// Same local-reactive-copy pattern as the popup's own personalDataForm --
// synced from the store once GET_PERSONAL_DATA resolves, so an in-progress
// edit here isn't clobbered by a refetch.
const personalDataForm = reactive<PersonalData>({});

const exportPassphrase = ref('');
const restoreFile = ref<File | null>(null);
const restoreBackupPassphrase = ref('');
const restoreNewPassphrase = ref('');

onMounted(() => {
  allSitesLedger.fetchLedger();
  vault.fetchStatus();
  personalData.fetchPersonalData().then(() => {
    if (personalData.status === 'loaded') Object.assign(personalDataForm, personalData.data);
  });
  appSettings.fetchAppSettings();
  policies.fetchPolicies();
});

// Auto-lock is a <select>, not a UiToggle (unlike credentialSaveMode
// below) -- more than two states (30s/1min/5min/15min/30min/1hr/Never),
// so a plain native <select> is the simplest fit for one-off control
// like this; no UiSelect component exists yet and one control doesn't
// warrant introducing one.
const BASE_AUTO_LOCK_OPTIONS: { value: string; label: string }[] = [
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '300', label: '5 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' },
  { value: 'never', label: 'Never' },
];

// A native <select> can only ever hold a string value -- 'never' is the
// sentinel this computed maps to/from AppSettings' own `null` ("never
// auto-lock"). Applies immediately on change (no separate Save button),
// matching the popup's own Safe Mode toggle convention: this is a
// preference switch, not a form.
const autoLockSelectValue = computed<string>({
  get: () =>
    isAutoLockDisabled(appSettings.data.autoLockSeconds)
      ? 'never'
      : String(appSettings.data.autoLockSeconds),
  set: async (value: string) => {
    const autoLockSeconds = value === 'never' ? null : Number(value);
    await appSettings.saveAppSettings({ autoLockSeconds });
    if (appSettings.justSaved) toast.push('Auto-lock updated.', 'success');
  },
});

// AppSettingsSchema allows any positive integer, not just the seven
// values this UI offers -- if a stored autoLockSeconds ever falls outside
// BASE_AUTO_LOCK_OPTIONS (a direct SET_APP_SETTINGS call, a future
// migration, manual storage editing), a plain <select> would silently
// fall back to displaying its first option while the real value is
// something else entirely (/code-review, verification pass). Synthesizing
// a matching option for whatever the current value actually is keeps the
// dropdown always honest about what's stored, even for a value this UI
// doesn't itself offer choosing.
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const autoLockOptions = computed<{ value: string; label: string }[]>(() => {
  const current = autoLockSelectValue.value;
  if (BASE_AUTO_LOCK_OPTIONS.some((option) => option.value === current)) {
    return BASE_AUTO_LOCK_OPTIONS;
  }
  return [...BASE_AUTO_LOCK_OPTIONS, { value: current, label: `${current} seconds` }];
});

// Mirrors the popup's own toggleHighTrust() re-entrancy guard --
// appSettings.saving is this store's equivalent of firewall's
// togglingHighTrust, guarding against a double-click firing two
// concurrent saves.
// biome-ignore lint/correctness/noUnusedVariables: called from @update:model-value in <template> -- Biome only lints the <script> block, it can't see template usage.
async function toggleCredentialSaveMode(): Promise<void> {
  if (appSettings.saving) return;
  const next = appSettings.data.credentialSaveMode === 'auto' ? 'ask' : 'auto';
  await appSettings.saveAppSettings({ credentialSaveMode: next });
  if (appSettings.justSaved) {
    toast.push(next === 'auto' ? 'Auto-save enabled.' : 'Auto-save disabled.', 'success');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitPersonalData(): Promise<void> {
  await personalData.savePersonalData({ ...personalDataForm });
  if (personalData.justSaved) toast.push('Saved.', 'success');
}

// Phase 7 Part A M5 -- the Policy Engine's own global per-field defaults
// (background/policy/), fully working since Phase 4 with zero UI anywhere
// until now. One dropdown per field, right next to its own input.
const POLICY_ACTION_LABELS: Record<PolicyAction, string> = {
  real: 'Real',
  alias: 'Alias',
  synthetic: 'Synthetic',
  nonsense: 'Nonsense',
  deny: 'Deny',
  ask: 'Ask',
};

// 'default' is a UI-only sentinel, never sent as a PolicyAction -- it
// means "no explicit global rule; fall back to
// PERSONAL_DATA_FIELD_DEFAULT_ACTION," which is a materially different
// thing from an explicit 'ask' override (the latter freezes the choice
// even if the hardcoded default ever changes later).
// biome-ignore lint/correctness/noUnusedVariables: called from <template> -- Biome only lints the <script> block, it can't see template usage.
function globalPolicyOptions(fieldType: PersonalDataFieldName): { value: string; label: string }[] {
  const allowed = policies.availableResponses[fieldType] ?? [];
  const defaultAction = PERSONAL_DATA_FIELD_DEFAULT_ACTION[fieldType];
  return [
    { value: 'default', label: `Default (${POLICY_ACTION_LABELS[defaultAction]})` },
    ...allowed.map((action) => ({ value: action, label: POLICY_ACTION_LABELS[action] })),
    { value: 'ask', label: POLICY_ACTION_LABELS.ask },
  ];
}

// biome-ignore lint/correctness/noUnusedVariables: called from <template> -- Biome only lints the <script> block, it can't see template usage.
function currentGlobalPolicyValue(fieldType: PersonalDataFieldName): string {
  const rule = policies.policies.find(
    (p) => p.scope.kind === 'global' && p.fieldType === fieldType,
  );
  return rule ? rule.action : 'default';
}

// Forces every policy <select> below to remount after any change attempt
// (success or failure) -- a native <select>'s own DOM value already
// changes the moment the user picks an option (well before 'change'
// fires), so if the underlying policy value doesn't actually change (a
// failed save), Vue's vnode diff sees an unchanged :value prop and skips
// reapplying it, leaving the DOM showing the user's picked-but-not-
// persisted option. A forced remount re-derives the DOM from scratch
// instead of diffing against what the browser already did on its own --
// the same class of fix UiToggle's own :key trick uses elsewhere in this
// project, adapted for a control preventDefault() can't help with (a
// <select>'s visual change has already happened by the time 'change'
// fires, unlike a checkbox's click).
const policySelectRenderKey = ref(0);

// biome-ignore lint/correctness/noUnusedVariables: called from @change in <template> -- Biome only lints the <script> block, it can't see template usage.
async function onGlobalPolicyChange(fieldType: PersonalDataFieldName, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  const action = value === 'default' ? null : (value as PolicyAction);
  await policies.setGlobalPolicy(fieldType, action);
  policySelectRenderKey.value += 1;
  if (!policies.saveError) toast.push('Default updated.', 'success');
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitExportBackup(): Promise<void> {
  await vault.exportBackup(exportPassphrase.value);
  exportPassphrase.value = '';
  if (!vault.error) toast.push('Backup downloaded.', 'success');
}

// biome-ignore lint/correctness/noUnusedVariables: called from @change in <template> -- Biome only lints the <script> block, it can't see template usage.
function onRestoreFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  restoreFile.value = input.files?.[0] ?? null;
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickRestoreWithPasskey(): Promise<void> {
  if (!restoreFile.value) return;
  await vault.restoreWithPasskey(restoreFile.value, restoreBackupPassphrase.value);
  restoreBackupPassphrase.value = '';
  if (!vault.error) toast.push('Vault restored.', 'success');
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitRestoreWithPassphrase(): Promise<void> {
  if (!restoreFile.value) return;
  await vault.restoreWithPassphrase(
    restoreFile.value,
    restoreBackupPassphrase.value,
    restoreNewPassphrase.value,
  );
  restoreBackupPassphrase.value = '';
  restoreNewPassphrase.value = '';
  if (!vault.error) toast.push('Vault restored.', 'success');
}
</script>

<template>
  <main class="min-h-screen bg-if-white p-8 text-sm text-if-navy">
    <UiToastHost />

    <h1 class="flex items-center gap-2 font-heading text-lg font-bold text-if-navy">
      <Shield class="h-5 w-5" aria-hidden="true" /> Identity Firewall — Dashboard
    </h1>

    <nav class="mt-6 flex gap-1 border-b border-if-hairline">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        class="flex items-center gap-1.5 border-b-2 px-4 py-2 font-heading text-xs font-bold uppercase tracking-wide"
        :class="
          activeTab === tab.value
            ? 'border-if-blue text-if-navy'
            : 'border-transparent text-if-faint hover:text-if-subtle'
        "
        @click="activeTab = tab.value"
      >
        <component :is="tab.icon" class="h-3.5 w-3.5" aria-hidden="true" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- v-if, not v-show, for all three panels below -- with v-show every
         tab stays mounted (just CSS-hidden), so an error string like
         "VAULT_LOCKED" can appear in more than one panel's DOM at once
         (e.g. this ledger tab and the Personal Data tab both hit the same
         VaultLockedError on a fresh vault) -- harmless in the real UI, but
         it made Playwright's getByText resolve to two elements and fail
         strict mode (found writing tests/e2e/dashboard.test.ts). v-if is
         safe here since every ref/reactive this template binds to lives in
         this component's own setup(), not inside the panel itself, so
         switching tabs away and back never loses any state. -->
    <section v-if="activeTab === 'ledger'" class="mt-6 max-w-2xl">
      <p v-if="allSitesLedger.status === 'idle' || allSitesLedger.status === 'loading'" class="flex items-center gap-2 text-if-muted">
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="allSitesLedger.status === 'error'" class="text-red-600">
        {{ allSitesLedger.error }}
      </p>

      <p v-else-if="siteSummaries.length === 0" class="text-if-muted">
        No sites have any recorded disclosures or denials yet.
      </p>

      <div v-else class="space-y-4">
        <div
          v-for="site in siteSummaries"
          :key="site.origin"
          class="rounded border border-if-hairline p-3"
        >
          <h2 class="font-heading font-bold text-if-navy">{{ site.origin }}</h2>
          <div class="mt-2 space-y-1">
            <p
              v-for="[field, responseType] in site.disclosed"
              :key="`d-${field}`"
              class="flex items-center gap-1.5"
            >
              <Check class="h-3.5 w-3.5 text-green-600" aria-hidden="true" /> {{ field }}
              <span class="text-if-faint">({{ responseType }})</span>
            </p>
            <p v-for="field in site.denied" :key="`x-${field}`" class="flex items-center gap-1.5">
              <X class="h-3.5 w-3.5 text-red-600" aria-hidden="true" /> {{ field }}
            </p>
          </div>
          <p class="mt-2 text-xs text-if-faint">
            Last access: {{ new Date(site.lastAccess ?? 0).toLocaleString() }}
          </p>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'personalData'" class="mt-6 max-w-md">
      <p class="text-xs text-if-faint">What "Real" actually sends when you choose it for a field.</p>

      <p
        v-if="personalData.status === 'idle' || personalData.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="personalData.status === 'error'" class="mt-2 text-red-600">
        {{ personalData.error }}
      </p>

      <form v-else class="mt-2 space-y-2" novalidate @submit.prevent="submitPersonalData">
        <p class="text-xs text-if-faint">
          The dropdown next to each field is its own default answer for every site that asks,
          unless a site-specific rule overrides it -- reusing the Policy Engine's existing global
          rules (Phase 4), which never had a UI until now.
        </p>

        <div class="flex items-center gap-2">
          <UiTextInput v-model="personalDataForm.name" placeholder="Name" class="flex-1" />
          <select
            :key="`name-${policySelectRenderKey}`"
            :value="currentGlobalPolicyValue('name')"
            :disabled="policies.saving"
            class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
            @change="onGlobalPolicyChange('name', $event)"
          >
            <option v-for="option in globalPolicyOptions('name')" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <UiTextInput v-model="personalDataForm.email" type="email" placeholder="Email" class="flex-1" />
          <select
            :key="`email-${policySelectRenderKey}`"
            :value="currentGlobalPolicyValue('email')"
            :disabled="policies.saving"
            class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
            @change="onGlobalPolicyChange('email', $event)"
          >
            <option v-for="option in globalPolicyOptions('email')" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <UiTextInput v-model="personalDataForm.phone" type="tel" placeholder="Phone" class="flex-1" />
          <select
            :key="`phone-${policySelectRenderKey}`"
            :value="currentGlobalPolicyValue('phone')"
            :disabled="policies.saving"
            class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
            @change="onGlobalPolicyChange('phone', $event)"
          >
            <option v-for="option in globalPolicyOptions('phone')" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <UiTextInput v-model="personalDataForm.address" placeholder="Address" class="flex-1" />
          <select
            :key="`address-${policySelectRenderKey}`"
            :value="currentGlobalPolicyValue('address')"
            :disabled="policies.saving"
            class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
            @change="onGlobalPolicyChange('address', $event)"
          >
            <option v-for="option in globalPolicyOptions('address')" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <UiTextInput v-model="personalDataForm.birthDate" type="date" class="flex-1" />
          <select
            :key="`birthDate-${policySelectRenderKey}`"
            :value="currentGlobalPolicyValue('birthDate')"
            :disabled="policies.saving"
            class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
            @change="onGlobalPolicyChange('birthDate', $event)"
          >
            <option v-for="option in globalPolicyOptions('birthDate')" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <div class="flex items-center gap-2">
            <UiTextInput
              v-model="personalDataForm.nationalId"
              placeholder="National ID (e.g. CPF)"
              class="flex-1"
            />
            <select
              :key="`nationalId-${policySelectRenderKey}`"
              :value="currentGlobalPolicyValue('nationalId')"
              :disabled="policies.saving"
              class="rounded border border-if-hairline bg-if-white p-1.5 text-xs text-if-navy disabled:opacity-50"
              @change="onGlobalPolicyChange('nationalId', $event)"
            >
              <option
                v-for="option in globalPolicyOptions('nationalId')"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
          <p class="mt-1 text-xs text-if-faint">
            Highly sensitive -- Real or Deny only, never Alias/Synthetic/Nonsense.
          </p>
        </div>

        <UiButton type="submit" :loading="personalData.saving">Save</UiButton>
        <p v-if="personalData.saveError" class="text-xs text-red-600">
          {{ personalData.saveError }}
        </p>
        <p v-if="policies.saveError" class="text-xs text-red-600">{{ policies.saveError }}</p>
      </form>
    </section>

    <section v-if="activeTab === 'backup'" class="mt-6 max-w-md">
      <p v-if="vault.status === 'error'" class="text-red-600">{{ vault.error }}</p>

      <!-- 'idle' gets its own standalone branch, not chained with the
           v-else-if below -- combining it with 'loading' in one v-if would
           narrow vault.status to exclude 'loading' for every later branch
           too, breaking the `vault.status === 'loading'` disabled-checks
           inside them (a real vue-tsc error caught this). Matches
           entrypoints/popup/App.vue's own Vault section structure. -->
      <p v-if="vault.status === 'idle'" class="mt-2 flex items-center gap-2 text-if-muted">
        <UiSpinner size="sm" /> Loading…
      </p>

      <!-- No vault yet: point back to the popup for setup, offer restore
           right here -- restoreNewVault (background/vault/setup.ts) rejects
           with VAULT_ALREADY_INITIALIZED onto an already-set-up vault. -->
      <div v-else-if="!vault.initialized" class="space-y-3">
        <p class="text-if-muted">
          No vault yet. Open the extension icon to set one up, or restore one from a backup below.
        </p>

        <div class="space-y-2 rounded border border-if-hairline p-3">
          <p class="font-heading text-xs font-bold uppercase tracking-wide text-if-muted">
            Restore from backup
          </p>
          <input
            type="file"
            accept="application/json"
            class="w-full text-xs text-if-subtle"
            @change="onRestoreFileSelected"
          />
          <UiTextInput
            v-model="restoreBackupPassphrase"
            type="password"
            placeholder="Backup passphrase"
          />
          <UiButton
            :disabled="!restoreFile || restoreBackupPassphrase.length === 0"
            :loading="vault.status === 'loading'"
            @click="clickRestoreWithPasskey"
          >
            Restore + new Passkey
          </UiButton>
          <form class="space-y-2" @submit.prevent="submitRestoreWithPassphrase">
            <UiTextInput
              v-model="restoreNewPassphrase"
              type="password"
              placeholder="Choose a new passphrase"
            />
            <UiButton
              type="submit"
              variant="secondary"
              :disabled="
                !restoreFile ||
                restoreBackupPassphrase.length === 0 ||
                restoreNewPassphrase.length === 0
              "
              :loading="vault.status === 'loading'"
            >
              Restore + new Passphrase
            </UiButton>
          </form>
        </div>
      </div>

      <p v-else-if="vault.locked" class="text-if-muted">
        Vault is locked. Open the extension icon and unlock it first.
      </p>

      <div v-else class="space-y-3">
        <form class="space-y-2 rounded border border-if-hairline p-3" @submit.prevent="submitExportBackup">
          <p class="font-heading text-xs font-bold uppercase tracking-wide text-if-muted">
            Export backup
          </p>
          <UiTextInput
            v-model="exportPassphrase"
            type="password"
            placeholder="Choose a backup passphrase"
          />
          <UiButton
            type="submit"
            variant="secondary"
            :disabled="exportPassphrase.length === 0"
            :loading="vault.status === 'loading'"
          >
            Download backup
          </UiButton>
        </form>
      </div>
    </section>

    <section v-if="activeTab === 'configuration'" class="mt-6 max-w-md space-y-4">
      <p
        v-if="appSettings.status === 'idle' || appSettings.status === 'loading'"
        class="flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="appSettings.status === 'error'" class="text-red-600">
        {{ appSettings.error }}
      </p>

      <div v-else class="space-y-4">
        <div class="rounded border border-if-hairline p-3">
          <label for="auto-lock-select" class="font-heading text-xs font-bold uppercase tracking-wide text-if-muted">
            Auto-lock after
          </label>
          <p class="mt-1 text-xs text-if-faint">
            Locks the vault after this much inactivity, or immediately if the OS screen locks.
          </p>
          <select
            id="auto-lock-select"
            v-model="autoLockSelectValue"
            :disabled="appSettings.saving"
            class="mt-2 w-full rounded border border-if-hairline bg-if-white p-1.5 text-sm text-if-navy disabled:opacity-50"
          >
            <option v-for="option in autoLockOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="rounded border border-if-hairline p-3">
          <p class="font-heading text-xs font-bold uppercase tracking-wide text-if-muted">
            Saving a new login
          </p>
          <div class="mt-2">
            <UiToggle
              :model-value="appSettings.data.credentialSaveMode === 'auto'"
              :disabled="appSettings.saving"
              @update:model-value="toggleCredentialSaveMode()"
            >
              <span class="text-sm text-if-navy">Auto-save without asking</span>
            </UiToggle>
          </div>
          <p class="mt-1 text-xs text-if-faint">
            Off (default): a "Save this login?" prompt appears every time. On: saved to your local
            vault immediately, with a confirmation the next time you open the extension icon.
          </p>
        </div>

        <div class="rounded border border-if-hairline p-3">
          <p class="font-heading text-xs font-bold uppercase tracking-wide text-if-muted">
            Filling a saved login
          </p>
          <div class="mt-2 flex items-center gap-3 text-sm">
            <span class="text-if-navy">Manual (click Fill)</span>
            <UiTooltip
              v-slot="{ id }"
              text="Coming in a later phase, once biometric authorization gates it -- see Phase 8."
            >
              <label class="flex items-center gap-1.5 text-if-faint" :aria-describedby="id">
                <input type="radio" disabled />
                Auto-fill
              </label>
            </UiTooltip>
          </div>
        </div>

        <p v-if="appSettings.saveError" class="text-xs text-red-600">{{ appSettings.saveError }}</p>
      </div>
    </section>
  </main>
</template>
