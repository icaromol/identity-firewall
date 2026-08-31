<script lang="ts" setup>
// M5 -- the real "sites detected this session" view, backed by
// stores/session.store.ts. M4 adds the Vault section's three real states
// (setup/locked/unlocked), backed by stores/vault.store.ts. Phase 3 M4/M5
// add the "Pending request" section below, backed by
// stores/firewall.store.ts -- the Identity Firewall's approval UI. Phase 4
// M5 adds "What this site knows about you", backed by
// stores/privacyLedger.store.ts. Phase 5 M1 adds "Personal data", backed
// by stores/personalData.store.ts -- the first screen that ever lets a
// real user populate the values "Real" has resolved to since Phase 3.
// Phase 5 M4 adds "Save this login?", backed by
// stores/pendingCredential.store.ts -- a login captured on submit by the
// content script, staged in session state until confirmed here.
import { computed, onMounted, reactive, ref } from 'vue';
import { getFieldKey } from '../../shared/fieldKey';
import type { ClassifiedField, ClassifiedForm } from '../../shared/messages';
import type { PersonalData, PersonalDataFieldName, ResponseType } from '../../shared/vault-schema';
import { useFirewallStore } from '../../stores/firewall.store';
import { usePendingCredentialStore } from '../../stores/pendingCredential.store';
import { usePersonalDataStore } from '../../stores/personalData.store';
import { usePrivacyLedgerStore } from '../../stores/privacyLedger.store';
import { useSessionStore } from '../../stores/session.store';
import { useVaultStore } from '../../stores/vault.store';

const session = useSessionStore();
const vault = useVaultStore();
const firewall = useFirewallStore();
const privacyLedger = usePrivacyLedgerStore();
const personalData = usePersonalDataStore();
const pendingCredential = usePendingCredentialStore();

// Aggregates every recorded ledger entry for this origin into the
// per-service summary privacy-model.md's own mockup shows ("Disclosed: ✓
// Email, ✓ Username / Denied: ✕ Name..."), not the raw per-event list --
// a field can appear in both a disclosed and a later denied entry (the
// user changed their mind between visits); the MOST RECENT entry touching
// that field wins, matching "what does this site currently have," not a
// full history of every past decision.
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const ledgerSummary = computed(() => {
  const disclosed = new Map<PersonalDataFieldName, ResponseType>();
  const denied = new Set<PersonalDataFieldName>();
  let lastAccess: number | null = null;

  for (const entry of privacyLedger.entries) {
    lastAccess = lastAccess === null ? entry.at : Math.max(lastAccess, entry.at);
    for (const field of entry.deniedFields) {
      denied.add(field);
      disclosed.delete(field);
    }
    for (const [field, responseType] of Object.entries(entry.disclosedFields) as [
      PersonalDataFieldName,
      ResponseType,
    ][]) {
      disclosed.set(field, responseType);
      denied.delete(field);
    }
  }

  return { disclosed, denied, lastAccess };
});

const setupPassphrase = ref('');
const unlockPassphrase = ref('');
const exportPassphrase = ref('');
const restoreFile = ref<File | null>(null);
const restoreBackupPassphrase = ref('');
const restoreNewPassphrase = ref('');

// A local reactive copy of PersonalData for the form to bind against --
// synced from the store once GET_PERSONAL_DATA resolves (below), rather
// than binding v-model directly to store.data, so an in-progress edit
// isn't clobbered if the store's data were ever refetched. A one-shot
// sync after the single fetchPersonalData() call below, not a lifetime
// watch(status) -- that call only ever runs once (onMounted), so a
// persistent subscription was more machinery than the actual lifecycle
// needs (/code-review finding).
const personalDataForm = reactive<PersonalData>({});

onMounted(() => {
  session.fetchSessionState();
  vault.fetchStatus();
  firewall.fetchPendingRequest();
  privacyLedger.fetchLedger();
  personalData.fetchPersonalData().then(() => {
    if (personalData.status === 'loaded') Object.assign(personalDataForm, personalData.data);
  });
  pendingCredential.fetchPendingCredential();
});

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitPersonalData() {
  // patch is the full form snapshot, not a minimal diff -- SET_PERSONAL_DATA
  // itself is patch-style (a key omitted server-side leaves the stored
  // value untouched), which matters for a FUTURE caller sending a partial
  // object, not for this one, which always has every field in scope.
  personalData.savePersonalData({ ...personalDataForm });
}

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

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitSetupPassphrase() {
  vault.setupWithPassphrase(setupPassphrase.value);
  setupPassphrase.value = '';
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
function submitUnlockPassphrase() {
  vault.unlockWithPassphrase(unlockPassphrase.value);
  unlockPassphrase.value = '';
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
  <main class="p-4 text-sm text-neutral-100 bg-neutral-900">
    <h1 class="text-base font-semibold">Identity Firewall</h1>

    <section class="mt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Sites detected this session
      </h2>

      <!-- 'idle' (fetch hasn't run/completed yet) shares this branch with
           'loading', rather than falling through to the final v-else --
           otherwise a broken onMounted wiring would render identically to
           a genuinely empty session instead of visibly doing nothing. -->
      <p
        v-if="session.status === 'idle' || session.status === 'loading'"
        class="mt-2 text-neutral-400"
      >
        Loading…
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
    </section>

    <section class="mt-4 border-t border-neutral-800 pt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Pending request{{ firewall.origin ? ` — ${firewall.origin}` : '' }}
      </h2>

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
          @change="firewall.toggleHighTrust()"
        />
        Treat this site as government/financial (always ask, ignore policies)
      </label>

      <p v-if="firewall.highTrustError" class="mt-1 text-xs text-red-400">
        {{ firewall.highTrustError }}
      </p>

      <p v-if="firewall.isHighTrustOrigin" class="mt-2 text-amber-400">
        ⚠️ This site has been identified as a government/financial service. Automatic identity
        autofill has been disabled.
      </p>

      <p
        v-if="firewall.status === 'idle' || firewall.status === 'loading'"
        class="mt-2 text-neutral-400"
      >
        Loading…
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
           loads (fetchPendingRequest); only fields the engine itself left
           at 'ask' show a blank "Choose…" picker below. -->
      <div v-else class="mt-2 space-y-4">
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300"
            @click="firewall.applyDenyOptional()"
          >
            Deny optional fields
          </button>
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

          <button
            type="button"
            class="w-full rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
            :disabled="firewall.submittingFormIndex === form.formIndex"
            @click="firewall.submitForm(form.formIndex)"
          >
            Submit
          </button>
          <p v-if="firewall.submitErrors[form.formIndex]" class="text-xs text-red-400">
            {{ firewall.submitErrors[form.formIndex] }}
          </p>
        </div>
      </div>
    </section>

    <section v-if="pendingCredential.pending || pendingCredential.savedCredential" class="mt-4 border-t border-neutral-800 pt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Save this login{{ pendingCredential.origin ? ` — ${pendingCredential.origin}` : '' }}?
      </h2>

      <p v-if="pendingCredential.savedCredential" class="mt-2 text-green-400">Saved.</p>

      <div v-else-if="pendingCredential.pending" class="mt-2 space-y-2">
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
          <button
            type="button"
            class="flex-1 rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
            :disabled="pendingCredential.confirming"
            @click="pendingCredential.confirm()"
          >
            Save
          </button>
          <button
            type="button"
            class="flex-1 rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
            :disabled="pendingCredential.discarding"
            @click="pendingCredential.discard()"
          >
            Discard
          </button>
        </div>
        <p v-if="pendingCredential.actionError" class="text-xs text-red-400">
          {{ pendingCredential.actionError }}
        </p>
      </div>
    </section>

    <section class="mt-4 border-t border-neutral-800 pt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        What this site knows about you{{ privacyLedger.origin ? ` — ${privacyLedger.origin}` : '' }}
      </h2>

      <p
        v-if="privacyLedger.status === 'idle' || privacyLedger.status === 'loading'"
        class="mt-2 text-neutral-400"
      >
        Loading…
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
        <p v-for="[field, responseType] in ledgerSummary.disclosed" :key="`d-${field}`">
          <span class="text-green-400">✓</span> {{ field }}
          <span class="text-neutral-500">({{ responseType }})</span>
        </p>
        <p v-for="field in ledgerSummary.denied" :key="`x-${field}`">
          <span class="text-red-400">✕</span> {{ field }}
        </p>
        <p v-if="ledgerSummary.lastAccess" class="mt-2 text-xs text-neutral-500">
          Last access: {{ new Date(ledgerSummary.lastAccess).toLocaleString() }}
        </p>
      </div>
    </section>

    <section class="mt-4 border-t border-neutral-800 pt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Personal data</h2>
      <p class="mt-1 text-xs text-neutral-500">
        What "Real" actually sends when you choose it for a field.
      </p>

      <p
        v-if="personalData.status === 'idle' || personalData.status === 'loading'"
        class="mt-2 text-neutral-400"
      >
        Loading…
      </p>

      <!-- Most commonly VAULT_LOCKED -- same "plain error string, no
           special-casing" convention as the Pending request section
           above for the identical underlying cause. -->
      <p v-else-if="personalData.status === 'error'" class="mt-2 text-red-400">
        {{ personalData.error }}
      </p>

      <!-- novalidate: PersonalDataSchema never enforces email FORMAT (it's
           a bare z.string().optional()) -- without this, the browser's own
           native constraint validation on type="email" would silently
           block the whole form's submit (Name/Phone/etc included) the
           moment Email looks malformed, with no saveError ever shown
           (/code-review finding: submitPersonalData is never even called
           in that case). -->
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
        <p v-if="personalData.saveError" class="text-xs text-red-400">
          {{ personalData.saveError }}
        </p>
      </form>
    </section>

    <section class="mt-4 border-t border-neutral-800 pt-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Vault</h2>

      <p v-if="vault.status === 'error'" class="mt-2 text-red-400">{{ vault.error }}</p>

      <!-- 'idle' (fetchStatus hasn't resolved yet) gets its own branch --
           otherwise vault.store.ts's default state (initialized:false)
           would flash "set up your vault" on every popup open, even for an
           already-set-up vault, until the async VAULT_STATUS reply lands. -->
      <p v-if="vault.status === 'idle'" class="mt-2 text-neutral-400">Loading…</p>

      <!-- No vault yet: setup. Checked before `locked` -- a brand-new,
           uninitialized vault also reports locked:true, so checking `locked`
           first would show "please unlock" instead of "please set up". -->
      <div v-else-if="!vault.initialized" class="mt-2 space-y-3">
        <p class="text-neutral-400">Set up your vault to get started.</p>

        <button
          type="button"
          class="w-full rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
          :disabled="vault.status === 'loading'"
          @click="vault.setupWithPasskey()"
        >
          Set up with Passkey (recommended)
        </button>
        <p class="text-xs text-neutral-500">
          Uses your device's biometric or security key. Recommended over a passphrase -- see
          ADR-012.
        </p>

        <form class="space-y-2" @submit.prevent="submitSetupPassphrase">
          <input
            v-model="setupPassphrase"
            type="password"
            placeholder="Or choose a passphrase instead"
            class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
          />
          <button
            type="submit"
            class="w-full rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
            :disabled="vault.status === 'loading' || setupPassphrase.length === 0"
          >
            Set up with Passphrase
          </button>
        </form>

        <!-- Restore only makes sense pre-initialization -- restoreNewVault
             (background/vault/setup.ts) rejects with VAULT_ALREADY_INITIALIZED
             onto an already-set-up vault, matching this placement. -->
        <div class="space-y-2 border-t border-neutral-800 pt-3">
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

        <button
          v-if="
            vault.configuredUnlockMethod === undefined ||
            (vault.configuredUnlockMethod === 'passkey' && vault.passkeyCredentialId)
          "
          type="button"
          class="w-full rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900 disabled:opacity-50"
          :disabled="vault.status === 'loading'"
          @click="vault.unlockWithPasskey()"
        >
          Unlock with Passkey
        </button>

        <form
          v-if="
            vault.configuredUnlockMethod === undefined ||
            vault.configuredUnlockMethod === 'passphrase' ||
            (vault.configuredUnlockMethod === 'passkey' && !vault.passkeyCredentialId)
          "
          class="space-y-2"
          @submit.prevent="submitUnlockPassphrase"
        >
          <input
            v-model="unlockPassphrase"
            type="password"
            placeholder="Passphrase"
            class="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100"
          />
          <button
            type="submit"
            class="w-full rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
            :disabled="vault.status === 'loading' || unlockPassphrase.length === 0"
          >
            Unlock with Passphrase
          </button>
        </form>
      </div>

      <!-- Unlocked. Per decision 6, nothing about vault CONTENTS is shown
           here -- just the fact that it's unlocked. Export only prompts for
           a backup passphrase and triggers a download -- it doesn't display
           any vault content either, so it's compatible with that rule. -->
      <div v-else class="mt-2 space-y-3">
        <p class="text-green-400">Vault unlocked.</p>
        <button
          type="button"
          class="rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 disabled:opacity-50"
          :disabled="vault.status === 'loading'"
          @click="vault.lock()"
        >
          Lock
        </button>

        <form class="space-y-2 border-t border-neutral-800 pt-3" @submit.prevent="submitExportBackup">
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
