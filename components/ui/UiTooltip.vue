<script lang="ts" setup>
// A small, reusable, CSS-only tooltip -- no positioning library, no JS at
// all beyond generating an id: `group`/`group-hover`/`group-focus-within`
// (Tailwind) show a floating bubble below whatever's in the default slot,
// on hover OR keyboard focus (so a focusable trigger, e.g. a button, is
// reachable without a mouse too). Built for the "compact control + a
// word, full explanation on hover" pattern this project is standardizing
// on: a label/control shortened to just an icon and a word needs
// SOMEWHERE for the fuller explanation to live, and this is that
// somewhere -- reused wherever else a control gets the same treatment,
// not just its first use site.
//
// The default slot is scoped, exposing `id` -- the caller MUST bind
// `:aria-describedby="id"` onto its own trigger element (or, for a
// component whose root isn't the actual focusable control, e.g.
// UiToggle, forward it down to whichever element really is). A
// /code-review finding caught the first version of this component
// showing the explanation ONLY visually (via hover/focus opacity), with
// nothing wiring it to assistive tech at all -- `role="tooltip"` alone
// does not associate an element with a trigger; the WAI-ARIA tooltip
// pattern requires aria-describedby for that.
//
// `align` defaults to centering the bubble under its trigger, which
// overflows off-screen (clipped by the popup's own fixed width, not
// scrollable) for a trigger sitting right at an edge -- found manually
// checking this component's own first use site, the header's vault icon
// in the popup's top-right corner. `align="end"` right-aligns the bubble
// to the trigger instead for exactly that case; there's no JS here to
// detect this automatically, so the caller has to know its own position.
import { useId } from 'vue';

withDefaults(defineProps<{ text: string; align?: 'center' | 'end' }>(), { align: 'center' });
// biome-ignore lint/correctness/noUnusedVariables: read from <template> -- Biome only lints the <script> block, it can't see template usage.
const tooltipId = useId();
</script>

<template>
  <span class="group relative inline-flex">
    <slot :id="tooltipId" />
    <span
      :id="tooltipId"
      role="tooltip"
      class="pointer-events-none absolute top-full z-50 mt-1.5 w-max max-w-56 rounded border border-if-navy bg-if-navy px-2 py-1 text-xs text-if-white/90 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      :class="align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'"
    >
      {{ text }}
    </span>
  </span>
</template>
