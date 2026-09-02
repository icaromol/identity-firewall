<script lang="ts" setup>
// Replaces the two button class strings ("primary": solid light button;
// "secondary": outlined) that were previously repeated verbatim, by hand,
// at every single call site across both entrypoints' App.vue files.
// biome-ignore lint/correctness/noUnusedImports: used in <template> -- Biome only lints the <script> block, it can't see template usage.
import UiSpinner from './UiSpinner.vue';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary';
    type?: 'button' | 'submit';
    disabled?: boolean;
    // Shows a spinner and disables the button -- distinct from `disabled`
    // so a caller can express "this is disabled because it's mid-flight"
    // without also having to spell out disabled={x || y} at every call
    // site the way the pre-refactor markup did.
    loading?: boolean;
    // Most buttons in both entrypoints stretch to fill their container;
    // a handful (Lock, Deny optional fields) sit inline instead.
    block?: boolean;
    // 'sm' is for the one chip-style inline action (Deny optional fields)
    // that was previously left as a raw <button> during the components/ui/
    // migration specifically because its tighter padding/text-xs sizing
    // didn't fit 'md''s fixed dimensions -- a /code-review finding caught
    // that omission as silent drift from this file's own stated goal.
    size?: 'sm' | 'md';
  }>(),
  { variant: 'primary', type: 'button', disabled: false, loading: false, block: true, size: 'md' },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="flex items-center justify-center gap-2 rounded font-medium disabled:opacity-50"
    :class="[
      variant === 'primary'
        ? 'bg-neutral-100 text-neutral-900'
        : 'border border-neutral-700 text-neutral-300',
      block ? 'w-full' : '',
      size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5',
    ]"
  >
    <UiSpinner v-if="loading" size="sm" />
    <slot />
  </button>
</template>
