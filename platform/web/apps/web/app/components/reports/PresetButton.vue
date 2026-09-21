<script setup lang="ts">
/**
 * One standard report, offered as a button that explains itself (ADR-057).
 *
 * A preset's `description` is the only sentence that says what a standard report asks — "How
 * the blinds respond to an open, by the opener's seat." — and it used to sit behind a `title=`,
 * which no keyboard or finger ever reaches. It goes through `RegistryTerm` like a stat's
 * description does, with the button itself as the trigger, so opening a report and reading what
 * it is are one control. Shared by the reports workbench and the pool page, which had two copies
 * of the same button.
 */
import RegistryTerm from './RegistryTerm.vue';

const props = defineProps<{
  preset: { code: string; label: string; description: string };
  disabled: boolean;
  testid: string;
  /** The pool page draws its presets one size up. */
  size?: 'sm' | 'md';
}>();

const emit = defineEmits<{ open: [] }>();

const SIZE_CLASS = { sm: 'px-2 py-0.5 text-xs', md: 'px-3 py-1 text-sm' };
</script>

<template>
  <RegistryTerm :entry="{ term: props.preset.label, definition: props.preset.description }">
    <template #default="{ describedby }">
      <button
        type="button"
        :aria-describedby="describedby"
        :disabled="props.disabled"
        :data-testid="props.testid"
        class="rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        :class="SIZE_CLASS[props.size ?? 'sm']"
        @click="emit('open')"
      >
        {{ props.preset.label }}
      </button>
    </template>
  </RegistryTerm>
</template>
