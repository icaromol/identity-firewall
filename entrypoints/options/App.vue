<script lang="ts" setup>
// Phase 6 M1-M4 -- the extension's first UI surface that isn't the popup.
// A separate WXT entrypoint means a separate JS execution context and a
// separate Pinia instance from entrypoints/popup/App.vue -- nothing here
// inherits state the popup already fetched; every store below fetches its
// own data independently, the same "self-contained, independently
// testable stores" convention the popup's own stores already follow.
import { computed, onMounted, reactive, ref } from 'vue';
import type { PersonalData, PrivacyLedgerEntry } from '../../shared/vault-schema';
import { useAllSitesLedgerStore } from '../../stores/allSitesLedger.store';
import { usePersonalDataStore } from '../../stores/personalData.store';
import { type LedgerSummary, summarizeLedgerEntries } from '../../stores/shared/ledgerSummary';
import { useVaultStore } from '../../stores/vault.store';

const allSitesLedger = useAllSitesLedgerStore();
const personalData = usePersonalDataStore();
const vault = useVaultStore();

type Tab = 'ledger' | 'personalData' | 'backup';
// biome-ignore lint/correctness/noUnusedVariables: read/written from <template> -- Biome only lints the <script> block, it can't see template usage.
const activeTab = ref<Tab>('ledger');

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
});

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitPersonalData() {
  personalData.savePersonalData({ ...personalDataForm });
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitExportBackup() {
  vault.exportBackup(exportPassphrase.value);
  exportPassphrase.value = '';
}

// biome-ignore lint/correctness/noUnusedVariables: called from @change in <template> -- Biome only lints the <script> block, it can't see template usage.
function onRestoreFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  restoreFile.value = input.files?.[0] ?? null;
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
function clickRestoreWithPasskey() {
  if (!restoreFile.value) return;
  vault.restoreWithPasskey(restoreFile.value, restoreBackupPassphrase.value);
  restoreBackupPassphrase.value = '';
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitRestoreWithPassphrase() {
  if (!restoreFile.value) return;
  vault.restoreWithPassphrase(
    restoreFile.value,
    restoreBackupPassphrase.value,
    restoreNewPassphrase.value,
  );
  restoreBackupPassphrase.value = '';
  restoreNewPassphrase.value = '';
}
</script>

<template>
  <main class="min-h-screen bg-neutral-900 p-8 text-sm text-neutral-100">
    <h1 class="text-lg font-semibold">Identity Firewall — Dashboard</h1>

    <nav class="mt-6 flex gap-1 border-b border-neutral-800">
      <button
        v-for="tab in (['ledger', 'personalData', 'backup'] as const)"
        :key="tab"
        type="button"
        class="border-b-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
        :class="
          activeTab === tab
            ? 'border-neutral-100 text-neutral-100'
            : 'border-transparent text-neutral-500 hover:text-neutral-300'
        "
        @click="activeTab = tab"
      >
        {{
          tab === 'ledger'
            ? 'Who knows what about me'
            : tab === 'personalData'
              ? 'Personal data'
              : 'Backup & recovery'
        }}
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
      <p
        v-if="allSitesLedger.status === 'idle' || allSitesLedger.status === 'loading'"
        class="text-neutral-400"
      >
        Loading…
      </p>

      <p v-else-if="allSitesLedger.status === 'error'" class="text-red-400">
        {{ allSitesLedger.error }}
      </p>

      <p v-else-if="siteSummaries.length === 0" class="text-neutral-400">
        No sites have any recorded disclosures or denials yet.
      </p>

      <div v-else class="space-y-4">
        <div
          v-for="site in siteSummaries"
          :key="site.origin"
          class="rounded border border-neutral-800 p-3"
        >
          <h2 class="font-semibold">{{ site.origin }}</h2>
          <div class="mt-2 space-y-1">
            <p v-for="[field, responseType] in site.disclosed" :key="`d-${field}`">
              <span class="text-green-400">✓</span> {{ field }}
              <span class="text-neutral-500">({{ responseType }})</span>
            </p>
            <p v-for="field in site.denied" :key="`x-${field}`">
              <span class="text-red-400">✕</span> {{ field }}
            </p>
          </div>
          <p class="mt-2 text-xs text-neutral-500">
            Last access: {{ new Date(site.lastAccess ?? 0).toLocaleString() }}
          </p>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'personalData'" class="mt-6 max-w-md">
      <p class="text-xs text-neutral-500">What "Real" actually sends when you choose it for a field.</p>

      <p
        v-if="personalData.status === 'idle' || personalData.status === 'loading'"
        class="mt-2 text-neutral-400"
      >
        Loading…
      </p>

      <p v-else-if="personalData.status === 'error'" class="mt-2 text-red-400">
        {{ personalData.error }}
      </p>

      <form v-else class="mt-2 space-y-2" novalidate @submit.prevent="submitPersonalData">
        <input
          v-model="personalDataForm.name"
          type="text"
          placeholder="Name"
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <input
          v-model="personalDataForm.email"
          type="email"
          placeholder="Email"
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <input
          v-model="personalDataForm.phone"
          type="tel"
          placeholder="Phone"
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <input
          v-model="personalDataForm.address"
          type="text"
          placeholder="Address"
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <input
          v-model="personalDataForm.birthDate"
          type="date"
          class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <div>
          <input
            v-model="personalDataForm.nationalId"
            type="text"
            placeholder="National ID (e.g. CPF)"
            class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
          />
          <p class="mt-1 text-xs text-neutral-500">
            Highly sensitive -- always asked for, never filled automatically.
          </p>
        </div>

        <button
          type="submit"
          class="w-full rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
          :disabled="personalData.saving"
        >
          Save
        </button>
        <p v-if="personalData.justSaved" class="text-xs text-green-400">Saved.</p>
        <p v-else-if="personalData.saveError" class="text-xs text-red-400">
          {{ personalData.saveError }}
        </p>
      </form>
    </section>

    <section v-if="activeTab === 'backup'" class="mt-6 max-w-md">
      <p v-if="vault.status === 'error'" class="text-red-400">{{ vault.error }}</p>

      <!-- 'idle' gets its own standalone branch, not chained with the
           v-else-if below -- combining it with 'loading' in one v-if would
           narrow vault.status to exclude 'loading' for every later branch
           too, breaking the `vault.status === 'loading'` disabled-checks
           inside them (a real vue-tsc error caught this). Matches
           entrypoints/popup/App.vue's own Vault section structure. -->
      <p v-if="vault.status === 'idle'" class="mt-2 text-neutral-400">Loading…</p>

      <!-- No vault yet: point back to the popup for setup, offer restore
           right here -- restoreNewVault (background/vault/setup.ts) rejects
           with VAULT_ALREADY_INITIALIZED onto an already-set-up vault. -->
      <div v-else-if="!vault.initialized" class="space-y-3">
        <p class="text-neutral-400">
          No vault yet. Open the extension icon to set one up, or restore one from a backup below.
        </p>

        <div class="space-y-2 rounded border border-neutral-800 p-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Restore from backup
          </p>
          <input
            type="file"
            accept="application/json"
            class="w-full text-xs text-neutral-300"
            @change="onRestoreFileSelected"
          />
          <input
            v-model="restoreBackupPassphrase"
            type="password"
            placeholder="Backup passphrase"
            class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
          />
          <button
            type="button"
            class="w-full rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
            :disabled="
              vault.status === 'loading' || !restoreFile || restoreBackupPassphrase.length === 0
            "
            @click="clickRestoreWithPasskey"
          >
            Restore + new Passkey
          </button>
          <form class="space-y-2" @submit.prevent="submitRestoreWithPassphrase">
            <input
              v-model="restoreNewPassphrase"
              type="password"
              placeholder="Choose a new passphrase"
              class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
            />
            <button
              type="submit"
              class="w-full rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
              :disabled="
                vault.status === 'loading' ||
                !restoreFile ||
                restoreBackupPassphrase.length === 0 ||
                restoreNewPassphrase.length === 0
              "
            >
              Restore + new Passphrase
            </button>
          </form>
        </div>
      </div>

      <p v-else-if="vault.locked" class="text-neutral-400">
        Vault is locked. Open the extension icon and unlock it first.
      </p>

      <div v-else class="space-y-3">
        <form class="space-y-2 rounded border border-neutral-800 p-3" @submit.prevent="submitExportBackup">
          <p class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Export backup
          </p>
          <input
            v-model="exportPassphrase"
            type="password"
            placeholder="Choose a backup passphrase"
            class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
          />
          <button
            type="submit"
            class="w-full rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
            :disabled="vault.status === 'loading' || exportPassphrase.length === 0"
          >
            Download backup
          </button>
        </form>
      </div>
    </section>
  </main>
</template>
