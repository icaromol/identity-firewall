<script lang="ts" setup>
// Replaces the repeated "<section class='mt-4 border-t ...'><h2
// class='text-xs font-semibold uppercase ...'>TITLE</h2>...</section>"
// wrapper duplicated around every block in both entrypoints' App.vue
// files.
//
// `icon` takes an actual Lucide icon component (e.g. `:icon="Bell"`), not
// a string/emoji -- this project's standing convention (CLAUDE.md) is
// Lucide icons everywhere, never emoji, after emoji were tried here first
// and explicitly rejected by the user as unprofessional-looking.
import type { Component } from 'vue';

withDefaults(defineProps<{ title: string; icon?: Component; divider?: boolean }>(), {
  divider: true,
});
</script>

<template>
  <section :class="divider ? 'mt-4 border-t border-if-hairline pt-4' : 'mt-4'">
    <h2
      class="flex items-center gap-1.5 font-heading text-xs font-bold uppercase tracking-wide text-if-muted"
    >
      <component :is="icon" v-if="icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <slot name="title">{{ title }}</slot>
    </h2>
    <slot />
  </section>
</template>
