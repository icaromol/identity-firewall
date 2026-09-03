<script lang="ts" setup>
// Reusable "the vault needs to be unlocked before this tab/page can show
// anything" screen -- replaces the raw "VAULT_LOCKED" error string that
// used to render verbatim wherever a Dashboard tab's own fetch (Personal
// Data, the ledger) failed with that handler-level error. Distinguishes
// "never set up" from "set up but locked" (readVaultIndex() throws the
// exact same VaultLockedError for both, so a tab reading only that error
// string can't tell them apart -- this component asks vault.store.ts's
// own `initialized` flag instead, the same distinction the Backup &
// Recovery tab's own bespoke branch already made before this existed).
//
// Mirrors entrypoints/popup/App.vue's own Vault section (setup/unlock
// forms, passkey-vs-passphrase branching) rather than inventing new
// logic -- reuses the exact same vault.store.ts actions. Deliberately
// NOT wired into the popup itself: that section has popup-specific
// context (the header status icon, the "moved to the Dashboard" note)
// this generic version doesn't try to replace.
//
// biome-ignore-start lint/correctness/noUnusedImports: used in <template> -- Biome only lints the <script> block, it can't see template usage.
import { Lock } from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import { useVaultStore } from '../../stores/vault.store';
import UiButton from './UiButton.vue';
import UiSpinner from './UiSpinner.vue';
import UiTextInput from './UiTextInput.vue';

// biome-ignore-end lint/correctness/noUnusedImports: used in <template>

withDefaults(defineProps<{ description?: string }>(), { description: '' });

// Fires once, the moment this component's own action actually unlocks (or
// sets up) the vault -- callers use this to refetch whatever vault-scoped
// data their own tab needs, since this component has no way to know what
// that is.
const emit = defineEmits<{ unlocked: [] }>();

const vault = useVaultStore();

onMounted(() => {
  // Safe to call even if a parent already fetched vault status -- a plain
  // read, and this component needs to be self-contained (usable from any
  // tab without assuming a prior fetch happened).
  vault.fetchStatus();
});

watch(
  () => vault.locked,
  (locked, wasLocked) => {
    if (wasLocked && !locked) emit('unlocked');
  },
);

const setupPassphrase = ref('');
const unlockPassphrase = ref('');

// Same condition as the popup's own "Unlock with Passkey" button --
// undefined (unknown method, graceful degradation) or a passkey actually
// configured with its credential id present.
// biome-ignore lint/correctness/noUnusedVariables: called from <template> -- Biome only lints the <script> block, it can't see template usage.
function passkeyUsable(): boolean {
  return (
    vault.configuredUnlockMethod === undefined ||
    (vault.configuredUnlockMethod === 'passkey' && vault.passkeyCredentialId !== undefined)
  );
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickSetupWithPasskey(): Promise<void> {
  await vault.setupWithPasskey();
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitSetupPassphrase(): Promise<void> {
  await vault.setupWithPassphrase(setupPassphrase.value);
  setupPassphrase.value = '';
}

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickUnlockWithPasskey(): Promise<void> {
  await vault.unlockWithPasskey();
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitUnlockPassphrase(): Promise<void> {
  await vault.unlockWithPassphrase(unlockPassphrase.value);
  unlockPassphrase.value = '';
}
</script>

<template>
  <div class="mx-auto mt-12 max-w-xs text-center">
    <Lock class="mx-auto h-8 w-8 text-if-faint" aria-hidden="true" />

    <h2 class="mt-3 font-heading text-base font-bold text-if-navy">
      {{ vault.status === 'idle' ? 'Vault' : vault.initialized ? 'Vault is locked' : 'Vault not set up' }}
    </h2>
    <p v-if="description" class="mt-1 text-xs text-if-faint">{{ description }}</p>

    <p
      v-if="vault.status === 'idle'"
      class="mt-4 flex items-center justify-center gap-2 text-if-muted"
    >
      <UiSpinner size="sm" /> Loading…
    </p>

    <div v-else-if="!vault.initialized" class="mt-4 space-y-3 text-left">
      <UiButton :loading="vault.status === 'loading'" @click="clickSetupWithPasskey()">
        Set up with Passkey (recommended)
      </UiButton>
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

    <div v-else class="mt-4 space-y-3 text-left">
      <UiButton
        v-if="passkeyUsable()"
        :loading="vault.status === 'loading'"
        @click="clickUnlockWithPasskey()"
      >
        Unlock with Passkey
      </UiButton>
      <form
        v-if="!passkeyUsable()"
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

    <p v-if="vault.status === 'error'" class="mt-3 text-xs text-red-600">{{ vault.error }}</p>
  </div>
</template>
