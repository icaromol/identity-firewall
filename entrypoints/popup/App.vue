<script lang="ts" setup>
// M5 -- the real "sites detected this session" view, backed by
// stores/session.store.ts, plus a static Vault placeholder that makes no
// network or storage calls of any kind (Vault itself is Phase 2 -- see
// docs/plans/phase-1-extension-foundation.md).
import { onMounted } from 'vue';
import { useSessionStore } from '../../stores/session.store';

const session = useSessionStore();

onMounted(() => {
  session.fetchSessionState();
});
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
      <p class="mt-2 italic text-neutral-500">Not yet implemented — arrives in Phase 2.</p>
    </section>
  </main>
</template>
