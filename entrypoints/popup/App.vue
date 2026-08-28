<script lang="ts" setup>
// M5 -- the real "sites detected this session" view, backed by
// stores/session.store.ts. M4 adds the Vault section's three real states
// (setup/locked/unlocked), backed by stores/vault.store.ts.
import { onMounted, ref } from 'vue';
import { useSessionStore } from '../../stores/session.store';
import { useVaultStore } from '../../stores/vault.store';

const session = useSessionStore();
const vault = useVaultStore();

const setupPassphrase = ref('');
const unlockPassphrase = ref('');
const exportPassphrase = ref('');
const restoreFile = ref<File | null>(null);
const restoreBackupPassphrase = ref('');
const restoreNewPassphrase = ref('');

onMounted(() => {
  session.fetchSessionState();
  vault.fetchStatus();
});

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
