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
  Landmark,
  Lock,
  LockOpen,
  Save,
  ScrollText,
  Settings,
  Shield,
  ShieldBan,
  TriangleAlert,
  X,
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import UiButton from '../../components/ui/UiButton.vue';
import UiSection from '../../components/ui/UiSection.vue';
import UiSpinner from '../../components/ui/UiSpinner.vue';
import UiTextInput from '../../components/ui/UiTextInput.vue';
import UiToastHost from '../../components/ui/UiToastHost.vue';
import UiToggle from '../../components/ui/UiToggle.vue';
import UiTooltip from '../../components/ui/UiTooltip.vue';
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

// A persistent, at-a-glance, CLICKABLE vault-state icon in the header --
// once unlocked, it's the ONLY vault control left in the popup (the Vault
// section below hides itself entirely in that state, per the user's own
// request). Gated on `status === 'idle'`, not `status !== 'loaded'` -- a
// /code-review finding caught that the stricter check made this icon
// (and the Vault section's own outer v-if, below) both go blank for the
// brief 'loading' window every lock/unlock click passes through, since
// vault.lock()/unlockWithPasskey() set status='loading' synchronously
// before their own `locked`/`initialized` fields have actually changed.
// 'idle' only ever means "fetchStatus hasn't resolved even once yet" --
// after that, `locked`/`initialized` are always the best information
// available, including mid-transition, so there's no reason to hide
// anything just because a request happens to be in flight.
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const vaultStatusIcon = computed(() => {
  if (vault.status === 'idle') return null;
  if (!vault.initialized) return KeyRound;
  return vault.locked ? Lock : LockOpen;
});

// import.meta.env.BROWSER is a WXT build-time constant resolved per the
// `-b`/`--browser` target (e.g. `pnpm dev:firefox`), not a runtime
// user-agent sniff -- verified against WXT's own config typings
// (targetBrowsers narrows this to a string-literal union). WebAuthn from
// a Firefox extension popup throws "The operation is insecure" --
// confirmed via manual testing, a live Firefox bug closes the popup the
// instant a WebAuthn prompt would appear (see createPasskeyUnlockInput's
// own header comment in stores/vault.store.ts) -- so every passkey
// button here is disabled, with a tooltip explaining why, rather than
// letting the user hit that opaque browser error.
const isFirefox = import.meta.env.BROWSER === 'firefox';

// Whether a passkey unlock is CONFIGURED for this vault (or the method is
// still unknown, e.g. before setup has happened) -- independent of
// whether passkeys actually work in this browser at all. The passkey
// button additionally requires passkeyCredentialId to actually be present
// (not just configuredUnlockMethod === 'passkey') -- defense in depth
// against the case where that pairing was ever only partially persisted.
const passkeyConfigured = computed(
  () =>
    vault.configuredUnlockMethod === undefined ||
    (vault.configuredUnlockMethod === 'passkey' && vault.passkeyCredentialId !== undefined),
);

// "Blocked mode" -- while the vault is anything other than genuinely set
// up and unlocked, the popup shows ONLY the header and the Vault card
// (setup/unlock). Every site-scoped section below (Pending request,
// Saved logins, Privacy ledger, Sites detected this session) is gated on
// this, even "Sites detected this session," which doesn't actually
// depend on the vault at all -- a deliberate choice, confirmed with the
// user, favoring a genuinely minimal locked screen over keeping that one
// section independently visible.
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const vaultReady = computed(() => vault.status !== 'idle' && vault.initialized && !vault.locked);

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
function clickOpenOptions(): void {
  browser.runtime.openOptionsPage();
}

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

  // credentialSaveMode: 'auto' never stages a PendingCredential, so
  // there's nothing for pendingCredential.fetchPendingCredential() above
  // to surface -- this is the only remaining confirmation an auto-save
  // gets (docs/plans/autolock-and-configuration.md decision 5).
  pendingCredential.checkAutoSaveNotice().then((wasAutoSaved) => {
    if (wasAutoSaved) toast.push('Login saved automatically.', 'success');
  });
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

async function clickUnlockWithPasskey() {
  await vault.unlockWithPasskey();
  if (!vault.locked) refreshVaultScopedSections();
}

// What the header's icon button does, if anything, in the vault's current
// state -- deliberately narrow: only the two transitions that need no
// further input at all. Locking never needs anything beyond "do it";
// unlocking only qualifies here when a passkey is actually usable (the
// exact same condition the Locked section's own "Unlock with Passkey"
// button already checks below) -- a passphrase-only vault has no way to
// collect that passphrase from a bare icon click, so it stays null and
// the full Locked section (still rendered) is the only way in for that
// case. null also covers "not initialized" -- setup needs its own form
// UI no click alone can replace.
type VaultIconAction = 'lock' | 'unlockWithPasskey' | null;
const vaultIconAction = computed<VaultIconAction>(() => {
  if (vault.status !== 'loaded' || !vault.initialized) return null;
  if (!vault.locked) return 'lock';
  return passkeyConfigured.value && !isFirefox ? 'unlockWithPasskey' : null;
});

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const vaultIconLabel = computed(() => {
  if (vaultIconAction.value === 'lock') return 'Lock vault';
  if (vaultIconAction.value === 'unlockWithPasskey') return 'Unlock vault with passkey';
  return !vault.initialized ? 'Vault not set up' : 'Vault is locked';
});

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
async function clickVaultIcon(): Promise<void> {
  if (vaultIconAction.value === 'lock') {
    await vault.lock();
    // Checked, not unconditional -- a /code-review finding: every other
    // handler in this file guards its success toast on the real outcome
    // (this branch's own unlockWithPasskey sibling included, two lines
    // below), and a failed VAULT_LOCK call must never tell the user their
    // still-unlocked vault (holding personal data and credentials) is
    // safely locked.
    if (vault.locked) toast.push('Vault locked.', 'info');
  } else if (vaultIconAction.value === 'unlockWithPasskey') {
    await clickUnlockWithPasskey();
    if (!vault.locked) toast.push('Vault unlocked.', 'success');
  }
}

// biome-ignore lint/correctness/noUnusedVariables: called from @submit.prevent in <template> -- Biome only lints the <script> block, it can't see template usage.
async function submitUnlockPassphrase() {
  await vault.unlockWithPassphrase(unlockPassphrase.value);
  unlockPassphrase.value = '';
  if (!vault.locked) refreshVaultScopedSections();
}
</script>

<template>
  <main class="p-4 text-sm text-if-navy bg-if-white">
    <UiToastHost />

    <div class="flex items-center justify-between">
      <h1 class="flex items-center gap-1.5 font-heading text-base font-bold text-if-navy">
        <Shield class="h-4 w-4" aria-hidden="true" /> Identity Firewall
      </h1>
      <div class="flex items-center gap-1">
        <UiTooltip v-slot="{ id }" text="Open Dashboard" align="end">
          <button
            type="button"
            class="cursor-pointer rounded p-1 text-if-muted enabled:hover:text-if-blue"
            aria-label="Open Dashboard"
            :aria-describedby="id"
            @click="clickOpenOptions()"
          >
            <Settings class="h-4 w-4" aria-hidden="true" />
          </button>
        </UiTooltip>
        <UiTooltip v-if="vaultStatusIcon" v-slot="{ id }" :text="vaultIconLabel" align="end">
          <button
            type="button"
            class="rounded p-1 text-if-muted enabled:cursor-pointer enabled:hover:text-if-blue disabled:cursor-default"
            :disabled="vaultIconAction === null || vault.status === 'loading'"
            :aria-label="vaultIconLabel"
            :aria-describedby="id"
            @click="clickVaultIcon()"
          >
            <component :is="vaultStatusIcon" class="h-4 w-4" aria-hidden="true" />
          </button>
        </UiTooltip>
      </div>
    </div>

    <!-- Hidden once fully unlocked, per the user's own request -- once the
         header icon above is clickable (click it to Lock), there's
         nothing left in this section worth a whole card just to hold one
         redundant "Vault unlocked." line and a Lock button.

         Gated on status === 'idle', not status !== 'loaded' -- see
         vaultStatusIcon's own comment above for why: `locked`/
         `initialized` stay accurate through a 'loading' window too (only
         'idle' means "genuinely unknown yet"), and gating on the
         stricter check made this section flash back into view as an
         empty shell (matching none of its own branches below, since
         `locked` hasn't flipped yet) for the brief instant every lock
         click passes through (a /code-review finding). -->
    <UiSection
      v-if="vault.status === 'idle' || !vault.initialized || vault.locked"
      title="Vault"
      :icon="Key"
      :divider="false"
    >
      <p v-if="vault.status === 'error'" class="mt-2 text-red-600">{{ vault.error }}</p>

      <!-- 'idle' (fetchStatus hasn't resolved yet) gets its own branch --
           otherwise vault.store.ts's default state (initialized:false)
           would flash "set up your vault" on every popup open, even for an
           already-set-up vault, until the async VAULT_STATUS reply lands. -->
      <p v-if="vault.status === 'idle'" class="mt-2 flex items-center gap-2 text-if-muted">
        <UiSpinner size="sm" /> Loading…
      </p>

      <!-- No vault yet: setup. Checked before `locked` -- a brand-new,
           uninitialized vault also reports locked:true, so checking `locked`
           first would show "please unlock" instead of "please set up". -->
      <div v-else-if="!vault.initialized" class="mt-2 space-y-3">
        <p class="text-if-muted">Set up your vault to get started.</p>

        <UiTooltip
          v-if="isFirefox"
          v-slot="{ id }"
          text="Passkeys aren't supported in Firefox extensions yet -- use the passphrase option below."
        >
          <UiButton disabled :aria-describedby="id">Set up with Passkey (recommended)</UiButton>
        </UiTooltip>
        <UiButton v-else :loading="vault.status === 'loading'" @click="clickSetupWithPasskey()">
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

      <!-- Initialized but locked: unlock form, keyed off which method this
           vault was actually configured with (passkeyConfigured, above) --
           undefined -> show both, graceful degradation rather than an
           error. The passphrase form is shown whenever the passkey button
           ISN'T fully usable (including "usable in principle, but not on
           this browser" -- isFirefox), so the user is never left with
           zero visible way to unlock. -->
      <div v-else-if="vault.locked" class="mt-2 space-y-3">
        <p class="text-if-muted">Vault is locked.</p>

        <UiTooltip
          v-if="passkeyConfigured && isFirefox"
          v-slot="{ id }"
          text="Passkeys aren't supported in Firefox extensions yet -- use the passphrase option below."
        >
          <UiButton disabled :aria-describedby="id">Unlock with Passkey</UiButton>
        </UiTooltip>
        <UiButton
          v-else-if="passkeyConfigured"
          :loading="vault.status === 'loading'"
          @click="clickUnlockWithPasskey()"
        >
          Unlock with Passkey
        </UiButton>

        <form
          v-if="!passkeyConfigured || isFirefox"
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

    </UiSection>

    <!-- Blocked mode: nothing below this point exists in the DOM at all
         until vaultReady -- see that computed's own comment for why this
         includes "Sites detected this session" too, even though it isn't
         actually vault-scoped data. -->
    <template v-if="vaultReady">
      <!-- The site every section below is scoped to, shown once here rather
           than repeated in each of their own titles. -->
      <p v-if="currentOrigin" class="mt-4 truncate text-xs text-if-faint">
        {{ currentOrigin }}
      </p>

    <!-- These four sections are about a SPECIFIC SITE, so none of them are
         meaningful until the vault actually holds something to disclose --
         and now that they're only ever mounted at all once vaultReady is
         true (the <template> wrapper above), a VAULT_LOCKED error can no
         longer occur here at all; each section's own error branch only
         ever needs to handle a genuinely different failure (e.g. the
         tab-resolution failure tests/e2e/firewallApproval.test.ts
         exercises, reproducible once unlocked). -->
    <UiSection
      title="Pending request"
      :icon="Bell"
      :class="firewall.forms.length > 0 ? 'border-l-2 border-amber-500/60 pl-2 -ml-2' : ''"
    >
      <!-- Government/financial safe mode (Phase 4 M6) -- a standing
           per-site setting, shown whenever the origin is known regardless
           of whether a request happens to be pending right now. Compact:
           an icon, one word, and a switch -- the full explanation moved
           into the tooltip instead of sitting in the row permanently. -->
      <div v-if="firewall.origin" class="mt-2">
        <!-- "Safe mode" is inside UiToggle's own <label> (its default
             slot), not a separate sibling -- a /code-review finding
             caught an earlier version with the visible text OUTSIDE the
             label, shrinking the clickable area down to just the small
             switch itself. Wrapping this label in the tooltip means the
             whole row (a real, focusable <input>) is the tooltip's
             trigger too, reachable via keyboard, not just a decorative
             span a keyboard user could never focus. -->
        <UiTooltip v-slot="{ id }" text="Always ask, ignore saved policies for this site.">
          <UiToggle
            :model-value="firewall.isHighTrustOrigin"
            :disabled="firewall.togglingHighTrust"
            :aria-describedby="id"
            @update:model-value="toggleHighTrust()"
          >
            <span class="flex items-center gap-1.5 text-xs text-if-muted">
              <Landmark class="h-3.5 w-3.5" aria-hidden="true" /> Safe mode
            </span>
          </UiToggle>
        </UiTooltip>
      </div>

      <p v-if="firewall.highTrustError" class="mt-1 text-xs text-red-600">
        {{ firewall.highTrustError }}
      </p>

      <p v-if="firewall.isHighTrustOrigin" class="mt-2 flex items-start gap-1.5 text-amber-600">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        This site has been identified as a government/financial service. Automatic identity
        autofill has been disabled.
      </p>

      <p
        v-if="firewall.status === 'idle' || firewall.status === 'loading'"
        class="mt-2 flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="firewall.status === 'error'" class="mt-2 text-red-600">
        Could not load pending request: {{ firewall.error }}
      </p>

      <!-- Requires PersonalData, which requires an unlocked vault --
           handleGetPendingRequest throws VaultLockedError otherwise,
           surfaced here as a plain error string rather than a crash. -->
      <p v-else-if="firewall.forms.length === 0" class="mt-2 text-if-muted">
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
          <UiTooltip v-slot="{ id }" text="Sets every optional field on this form to Deny in one click.">
            <UiButton
              variant="secondary"
              size="sm"
              :block="false"
              :aria-describedby="id"
              @click="clickDenyOptional()"
            >
              <ShieldBan class="h-3.5 w-3.5" aria-hidden="true" /> Deny optional
            </UiButton>
          </UiTooltip>
        </div>

        <div
          v-for="form in firewall.forms"
          :key="form.formIndex"
          class="space-y-2 rounded border border-if-hairline p-2"
        >
          <ul class="space-y-1">
            <li
              v-for="entry in fieldEntries(form)"
              :key="entry.key"
              class="flex items-center justify-between gap-2"
            >
              <div>
                <span>{{ entry.field.fieldType }}</span>
                <span class="ml-1 text-xs text-if-faint">{{ entry.field.sensitivity }}</span>
                <span v-if="!entry.field.apparentlyRequired" class="ml-1 text-xs text-if-faint"
                  >(optional)</span
                >
              </div>
              <select
                class="rounded border border-if-line bg-if-biscuit px-1 py-0.5 text-xs text-if-navy"
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
          <p v-if="firewall.submitErrors[form.formIndex]" class="text-xs text-red-600">
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
        <p class="text-if-subtle">
          {{ pendingCredential.pending.identifier ?? '(no username/email detected)' }}
        </p>
        <UiTextInput
          :model-value="pendingCredential.pending.password"
          type="password"
          readonly
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
        <p v-if="pendingCredential.actionError" class="text-xs text-red-600">
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
        class="mt-2 flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="savedCredentials.status === 'error'" class="mt-2 text-red-600">
        {{ savedCredentials.error }}
      </p>

      <p v-else-if="savedCredentials.credentials.length === 0" class="mt-2 text-if-muted">
        Nothing saved for this site yet.
      </p>

      <div v-else class="mt-2 space-y-2">
        <ul class="space-y-2">
          <li
            v-for="credential in savedCredentials.credentials"
            :key="credential.kind"
            class="space-y-1 rounded border border-if-hairline p-2"
          >
            <template v-if="credential.kind === 'password'">
              <p class="text-if-subtle">{{ credential.username ?? '(no username)' }}</p>
              <!-- type="text", not "password" -- decision 3 (the plan)
                   requires this list to show what's saved plainly, no
                   masking; that's Phase 8's job, once there's a proper
                   in-page reveal-preview to build instead. -->
              <UiTextInput :model-value="credential.password" type="text" readonly />
              <UiButton
                variant="secondary"
                :loading="savedCredentials.filling === credential"
                @click="clickFillCredential(credential)"
              >
                Fill
              </UiButton>
            </template>
            <p v-else class="text-if-muted">Passkey (not fillable this way)</p>
          </li>
        </ul>
        <p v-if="savedCredentials.fillError" class="text-xs text-red-600">
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
        class="mt-2 flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="privacyLedger.status === 'error'" class="mt-2 text-red-600">
        {{ privacyLedger.error }}
      </p>

      <p
        v-else-if="ledgerSummary.disclosed.size === 0 && ledgerSummary.denied.size === 0"
        class="mt-2 text-if-muted"
      >
        No history for this site yet.
      </p>

      <div v-else class="mt-2 space-y-1">
        <p v-for="[field, responseType] in ledgerSummary.disclosed" :key="`d-${field}`" class="flex items-center gap-1.5">
          <Check class="h-3.5 w-3.5 text-green-600" aria-hidden="true" /> {{ field }}
          <span class="text-if-faint">({{ responseType }})</span>
        </p>
        <p v-for="field in ledgerSummary.denied" :key="`x-${field}`" class="flex items-center gap-1.5">
          <X class="h-3.5 w-3.5 text-red-600" aria-hidden="true" /> {{ field }}
        </p>
        <p v-if="ledgerSummary.lastAccess" class="mt-2 text-xs text-if-faint">
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
        class="mt-2 flex items-center gap-2 text-if-muted"
      >
        <UiSpinner size="sm" /> Loading…
      </p>

      <p v-else-if="session.status === 'error'" class="mt-2 text-red-600">
        Could not load session state: {{ session.error }}
      </p>

      <ul v-else-if="session.originsWithForms.length > 0" class="mt-2 space-y-1">
        <li
          v-for="entry in session.originsWithForms"
          :key="entry.origin"
          class="flex items-center justify-between"
        >
          <span>{{ entry.origin }}</span>
          <span class="text-if-muted">{{ entry.formCount }} form(s)</span>
        </li>
      </ul>

      <p v-else class="mt-2 text-if-muted">No forms detected yet this session.</p>
    </UiSection>
    </template>
  </main>
</template>
