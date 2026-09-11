<script setup lang="ts">
/**
 * What the grid's rows are (plan D.5: "rows are a group-by dimension").
 *
 * Order matters and is therefore shown: the first column is the outer grouping, so `position` then
 * `pot_type` is thirty rows of seat-then-pot and the reverse is thirty rows of pot-then-seat. The
 * engine allows four (`MAX_GROUP_BY`), applied as a `max_length`, so the cap is stated here rather
 * than collected as a 422.
 *
 * Adding a decision-only column here silently rules out every hand-grain stat — the same rule the
 * filter has, because `stats/router.py` checks the group-by exactly as it checks the filter. The
 * picker says which tables are left; `StatPicker` says which stats went.
 */
import { computed, ref } from 'vue';

import { groupableDimensions } from '~/reports/columns';
import type { Dimension } from '~/stats/api';
import { MAX_GROUP_BY } from '~/stats/api';

const props = defineProps<{
  dimensions: readonly Dimension[];
  selected: readonly string[];
  byCode: ReadonlyMap<string, Dimension>;
}>();

const emit = defineEmits<{ change: [codes: string[]]; describe: [code: string] }>();

const adding = ref('');

const available = computed(() => groupableDimensions(props.dimensions).filter((dim) => !props.selected.includes(dim.code)));
const full = computed(() => props.selected.length >= MAX_GROUP_BY);

function label(code: string): string {
  return props.byCode.get(code)?.label ?? code;
}

function add(code: string): void {
  adding.value = '';
  if (code !== '' && !full.value) emit('change', [...props.selected, code]);
}

function remove(code: string): void {
  emit('change', props.selected.filter((entry) => entry !== code));
}

/** Move a column one place out, so the nesting can be changed without starting again. */
function promote(index: number): void {
  if (index === 0) return;
  const next = [...props.selected];
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  emit('change', next);
}
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="groupby-picker">
    <div class="flex flex-wrap items-baseline gap-2 text-sm">
      <h2 class="font-medium">Rows</h2>
      <span class="text-xs text-zinc-500">grouped by, outermost first</span>
    </div>

    <ol v-if="props.selected.length" class="flex flex-wrap items-center gap-1" data-testid="groupby-list">
      <li v-for="(code, index) in props.selected" :key="code" class="flex items-center rounded-full border border-zinc-300 text-xs dark:border-zinc-700" :data-testid="`groupby-${code}`">
        <button
          v-if="index > 0"
          type="button"
          :aria-label="`move ${label(code)} outwards`"
          :data-testid="`groupby-promote-${code}`"
          class="px-1.5 py-0.5 text-zinc-500"
          @click="promote(index)"
        >
          ←
        </button>
        <button type="button" :aria-label="`what ${label(code)} means`" class="px-2 py-0.5" @click="emit('describe', code)">{{ label(code) }}</button>
        <button type="button" :aria-label="`stop grouping by ${label(code)}`" :data-testid="`groupby-remove-${code}`" class="px-1.5 py-0.5 text-zinc-500" @click="remove(code)">×</button>
      </li>
    </ol>
    <p v-else class="text-sm text-zinc-500" data-testid="groupby-empty">Not grouped — one row for the whole situation.</p>

    <label class="flex items-center gap-2 text-sm">
      <span class="text-zinc-500">add</span>
      <select
        :value="adding"
        :disabled="full"
        aria-label="group by another column"
        data-testid="groupby-add"
        class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
        @change="add(($event.target as HTMLSelectElement).value)"
      >
        <option value="">choose a column…</option>
        <option v-for="dim in available" :key="dim.code" :value="dim.code">{{ dim.label }}</option>
      </select>
      <span v-if="full" class="text-xs text-zinc-500" data-testid="groupby-full">{{ MAX_GROUP_BY }} is the most one report can group by.</span>
    </label>
  </section>
</template>
