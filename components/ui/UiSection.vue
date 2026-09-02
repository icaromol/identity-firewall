<script lang="ts" setup>
// Replaces the repeated "<section class='mt-4 border-t ...'><h2
// class='text-xs font-semibold uppercase ...'>TITLE</h2>...</section>"
// wrapper duplicated around every block in both entrypoints' App.vue
// files.
withDefaults(defineProps<{ title: string; divider?: boolean }>(), { divider: true });
</script>

<template>
  <section :class="divider ? 'mt-4 border-t border-neutral-800 pt-4' : 'mt-4'">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">
      <slot name="title">{{ title }}</slot>
    </h2>
    <slot />
  </section>
</template>
