<script lang="ts" setup>
// Mounted once near the root of each entrypoint's App.vue (popup and
// options each get their own instance, backed by their own separate
// Pinia -- see stores/shared/toast.store.ts's own header comment).
import { useToastStore } from '../../stores/shared/toast.store';

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const toast = useToastStore();

// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const VARIANT_CLASSES: Record<string, string> = {
  success: 'border-green-500/40 text-green-300',
  error: 'border-red-500/40 text-red-300',
  info: 'border-neutral-700 text-neutral-200',
};
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3"
  >
    <TransitionGroup
      enter-active-class="motion-safe:transition motion-safe:duration-150"
      enter-from-class="motion-safe:opacity-0 motion-safe:translate-y-1"
      leave-active-class="motion-safe:transition motion-safe:duration-150"
      leave-to-class="motion-safe:opacity-0"
    >
      <div
        v-for="item in toast.toasts"
        :key="item.id"
        role="status"
        class="pointer-events-auto w-full max-w-sm cursor-pointer rounded-lg border bg-neutral-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
        :class="VARIANT_CLASSES[item.variant]"
        @click="toast.dismiss(item.id)"
      >
        {{ item.message }}
      </div>
    </TransitionGroup>
  </div>
</template>
