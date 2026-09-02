<script lang="ts" setup>
// Replaces the single input class string ("w-full rounded border
// border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100") that was
// previously repeated verbatim at every text/email/tel/date/password/file
// input across both entrypoints' App.vue files -- the actual source of
// the inconsistent-feeling UI: any one call site drifting from the others
// (a missing class, a typo) was invisible until it rendered oddly.
// biome-ignore lint/correctness/noUnusedVariables: read/written from <template> -- Biome only lints the <script> block, it can't see template usage.
const model = defineModel<string>();

withDefaults(
  defineProps<{
    type?: string;
    placeholder?: string;
    required?: boolean;
    readonly?: boolean;
  }>(),
  { type: 'text', required: false, readonly: false },
);
</script>

<template>
  <input
    v-model="model"
    :type="type"
    :placeholder="placeholder"
    :required="required"
    :readonly="readonly"
    class="w-full rounded border border-if-line bg-if-biscuit px-2 py-1 text-if-navy"
  />
</template>
