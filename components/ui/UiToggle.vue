<script lang="ts" setup>
// A compact on/off switch -- a real <input type="checkbox"> underneath
// (native keyboard/screen-reader semantics for free), visually hidden and
// replaced with a small pill+knob driven entirely by Tailwind's
// `peer-checked:` variant. Controlled, not defineModel-bound to the
// underlying store value directly: the actions this toggles (e.g. Safe
// Mode) are async with their own re-entrancy guard, so the parent passes
// the CURRENT confirmed state down via `modelValue` and reacts to
// `update:modelValue` by calling its own action -- the toggle's visual
// state always reflects what's actually true, not what was clicked.
//
// The default slot renders INSIDE the same <label> as the checkbox --
// a /code-review finding caught an earlier version that put the visible
// "Safe mode" text in a sibling, aria-hidden span outside this label,
// shrinking the clickable area down to just the ~28x16px switch itself
// (plain <label>-wraps-<input> semantics is exactly what makes the WHOLE
// row clickable, and it's also how the checkbox gets its accessible name
// for free, with no separate `label` prop needed here).
//
// The single click handler below calls preventDefault() AND emits, both
// in the same call -- an earlier /code-review finding caught a version
// that split these across @click (prevent only) and @change (emit only):
// preventing a checkbox's default click action also suppresses the
// 'change' event that action would otherwise have caused, so the
// emit-only handler never fired at all for a real click, and the switch
// did nothing.
//
// The reason for preventing the native toggle in the first place: a
// plain checkbox flips its own DOM `checked` property on click BEFORE
// any Vue handler runs. If the parent's async action then fails and
// `modelValue` never actually changes, that stale native `checked` would
// otherwise never get corrected, and the switch would visibly stay "on"
// for an action that never took effect.
//
// `:key="String(modelValue)"` forces a genuine remount of the <input>
// whenever modelValue changes, rather than an in-place DOM patch --
// verified empirically (a standalone Playwright repro, not just reasoning
// about it) that a plain `:checked="modelValue"` binding on this exact
// element does NOT reliably re-apply after a preventDefault()'d click on
// that same checkbox: the browser's own internal state for a
// just-interacted-with checkbox appears to resist Vue's normal prop
// patch for `checked` within that cycle, even though modelValue and the
// vnode's own checked prop both genuinely changed. A full remount sets
// `checked` fresh from scratch, sidestepping whatever that in-place-patch
// inconsistency actually is, rather than relying on it.
//
// That remount has its own side effect a /code-review finding also
// caught: destroying and recreating a focused element drops focus to
// <body>, so a keyboard user who just toggled this successfully gets
// silently bounced out of their place in the popup. The watcher below
// re-focuses the new element after a remount, but only when THIS click
// is what caused it (`refocusPending`) -- an unrelated external change
// to modelValue while the toggle never had focus shouldn't steal it.
// `onBlur` clears the flag too -- a second /code-review finding caught
// that a click whose action then FAILS (modelValue never changes) left
// `refocusPending` stuck true indefinitely, since the watcher (the only
// other place it was cleared) never fires without a real value change;
// if the user then moved on and focused something else entirely, a
// LATER, wholly unrelated modelValue change (e.g. a refresh elsewhere in
// the popup) would fire the watcher and yank focus back onto this
// toggle mid-typing. Losing focus is the clearest possible signal that
// whatever refocus intent this click had is no longer relevant.
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  ariaDescribedby?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const inputRef = ref<HTMLInputElement | null>(null);
let refocusPending = false;

// biome-ignore lint/correctness/noUnusedVariables: called from @click in <template> -- Biome only lints the <script> block, it can't see template usage.
function onClick(event: MouseEvent): void {
  event.preventDefault();
  if (props.disabled) return;
  refocusPending = document.activeElement === inputRef.value;
  emit('update:modelValue', !props.modelValue);
}

// biome-ignore lint/correctness/noUnusedVariables: called from @blur in <template> -- Biome only lints the <script> block, it can't see template usage.
function onBlur(): void {
  refocusPending = false;
}

watch(
  () => props.modelValue,
  async () => {
    if (!refocusPending) return;
    refocusPending = false;
    await nextTick();
    inputRef.value?.focus();
  },
);
</script>

<template>
  <label class="inline-flex items-center gap-2" :class="disabled ? 'cursor-default' : 'cursor-pointer'">
    <slot />
    <span class="relative inline-flex h-4 w-7 shrink-0 items-center">
      <input
        ref="inputRef"
        :key="String(modelValue)"
        type="checkbox"
        class="peer sr-only"
        :checked="modelValue"
        :disabled="disabled"
        :aria-describedby="ariaDescribedby"
        @click="onClick"
        @blur="onBlur"
      />
      <span
        class="h-4 w-7 rounded-full bg-neutral-700 transition-colors peer-checked:bg-neutral-100 peer-disabled:opacity-50"
      />
      <span
        class="absolute left-0.5 h-3 w-3 rounded-full bg-neutral-900 transition-transform peer-checked:translate-x-3.5"
      />
    </span>
  </label>
</template>
