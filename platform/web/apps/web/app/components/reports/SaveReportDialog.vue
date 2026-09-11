<script setup lang="ts">
/**
 * Save this report under a name (plan D.5).
 *
 * A native `&lt;dialog&gt;`, which is the first modal in this app and deliberately so: `showModal()`
 * brings focus trapping, Esc-to-close and inert background with no dependency and no hand-rolled
 * focus management, and the spec's keyboard-first requirement is easier to meet by using the
 * platform's dialog than by reimplementing it. An inline panel was the alternative and was
 * rejected because it can be scrolled away from while holding an unsaved name.
 *
 * What is stored is the engine's own `ReportRequest` — the same document that just ran — so the
 * server validates it end to end on the way in (`stats/service.py#validate_request`) and a saved
 * report is one that will still run when it is reopened.
 */
import { computed, ref, watch } from 'vue';

import type { Module, SavedReport } from '~/reports/api';

const props = defineProps<{
  open: boolean;
  /** The report being replaced, when the founder is saving over one they opened. */
  existing: SavedReport | null;
  /** Whether the typed name is already used by another of their reports. */
  taken: boolean;
  busy: boolean;
  failure: string;
  suggestedName: string;
  suggestedModule: Module;
}>();

const emit = defineEmits<{
  save: [payload: { name: string; module: Module; replace: boolean }];
  close: [];
  'update:name': [name: string];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const name = ref('');
const module = ref<Module>('hero');
const replace = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = props.suggestedName;
      module.value = props.suggestedModule;
      replace.value = props.existing !== null;
      dialog.value?.showModal();
    } else dialog.value?.close();
  },
);

watch(name, (value) => emit('update:name', value));

const trimmed = computed(() => name.value.trim());

/*
 * `taken` is decided with `nameTaken(saved, name, openId)`, which already excludes the report
 * being replaced — so keeping your own name while replacing is not "taken", and a clash is a
 * clash with a *different* report whether or not Replace is ticked. An earlier `&& !replace.value`
 * here suppressed the warning in exactly the case that would have earned the server's 409:
 * replacing one report under another one's name. Found in the browser.
 */
const blocked = computed(() => trimmed.value === '' || props.busy || props.taken);

function submit(): void {
  if (blocked.value) return;
  emit('save', { name: trimmed.value, module: module.value, replace: replace.value });
}
</script>

<template>
  <dialog
    ref="dialog"
    data-testid="save-dialog"
    class="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-zinc-900/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    aria-label="save this report"
    @close="emit('close')"
  >
    <form class="w-80 space-y-3" @submit.prevent="submit">
      <h2 class="font-medium">Save this report</h2>

      <label class="block space-y-1 text-sm">
        <span class="text-zinc-500">Name</span>
        <input
          v-model="name"
          type="text"
          required
          maxlength="120"
          data-testid="save-name"
          class="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
        />
      </label>

      <label class="block space-y-1 text-sm">
        <span class="text-zinc-500">Filed under</span>
        <select v-model="module" data-testid="save-module" class="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
          <option value="hero">My game</option>
          <option value="pool">The pool</option>
        </select>
      </label>

      <label v-if="props.existing" class="flex items-center gap-2 text-sm">
        <input v-model="replace" type="checkbox" data-testid="save-replace" />
        <span>Replace “{{ props.existing.name }}” rather than saving a new one</span>
      </label>

      <p v-if="props.taken" role="alert" data-testid="save-taken" class="text-xs text-amber-700 dark:text-amber-400">
        You already have a different report called “{{ trimmed }}”. Pick another name — open that
        report to replace it.
      </p>

      <p v-if="props.failure" role="alert" data-testid="save-error" class="text-sm text-red-600 dark:text-red-400">{{ props.failure }}</p>

      <div class="flex items-center gap-2">
        <button
          type="submit"
          :disabled="blocked"
          data-testid="save-submit"
          class="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {{ props.busy ? 'Saving…' : replace ? 'Replace' : 'Save' }}
        </button>
        <button type="button" data-testid="save-cancel" class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="emit('close')">
          Cancel
        </button>
      </div>
    </form>
  </dialog>
</template>
