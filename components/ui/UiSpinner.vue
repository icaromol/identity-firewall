<script lang="ts" setup>
// Shared by both entrypoints (popup, options) wherever a "Loading…" text
// label previously stood alone -- a spinner alongside the label gives an
// actually-moving signal that something is happening, not just static
// text that's easy to mistake for a stuck/broken state.
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'md' });
</script>

<template>
  <svg
    :class="size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'"
    class="animate-spin motion-reduce:animate-none"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
    <path
      class="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
</template>
