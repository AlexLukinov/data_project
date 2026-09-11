<script setup lang="ts">
/**
 * Which stats the grid's columns are (plan D.5).
 *
 * It offers only what the current situation and grouping can actually answer. That is not tidiness:
 * `stats/router.py` picks one fact table per stat from its grain and refuses a report whose filter
 * or group-by names a column that table lacks — before it validates anything else — so offering a
 * hand-grain stat under a decision-grain situation offers a 400. The rule is `reports/columns.ts`;
 * what this component adds is *saying so*, because a column that disappears without a word is
 * worse than the error it prevented.
 */
import { computed, ref } from 'vue';

import { groupByCategory } from '~/reports/columns';
import type { Stat } from '~/stats/api';

const props = defineProps<{
  /** The stats that fit — already narrowed by the situation and the grouping. */
  usable: readonly Stat[];
  /** Every stat the registry has, so the hidden count can be honest. */
  all: readonly Stat[];
  selected: readonly string[];
  /** Stats dropped because the situation moved under them, by label. */
  dropped: readonly string[];
  tables: readonly string[];
}>();

const emit = defineEmits<{ toggle: [code: string]; describe: [code: string] }>();

const search = ref('');

const groups = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const matching = needle === '' ? props.usable : props.usable.filter((stat) => matches(stat, needle));
  return groupByCategory(matching);
});

function matches(stat: Stat, needle: string): boolean {
  return stat.label.toLowerCase().includes(needle) || stat.code.includes(needle) || (stat.description ?? '').toLowerCase().includes(needle);
}

const hidden = computed(() => props.all.length - props.usable.length);
const where = computed(() => (props.tables.length === 0 ? 'no table' : props.tables.join(', ')));
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="stat-picker">
    <div class="flex flex-wrap items-baseline gap-2 text-sm">
      <h2 class="font-medium">Stats</h2>
      <span class="text-xs text-zinc-500">{{ selected.length }} chosen — the grid's columns, in this order</span>
      <input
        v-model="search"
        type="search"
        placeholder="Search stats…"
        aria-label="search stats"
        data-testid="stat-search"
        class="ml-auto w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
    </div>

    <div v-for="group in groups" :key="group.category" class="space-y-1">
      <p class="text-xs text-zinc-500">{{ group.label }}</p>
      <div class="flex flex-wrap gap-1">
        <span v-for="stat in group.stats" :key="stat.code" class="inline-flex items-center rounded border" :class="selected.includes(stat.code) ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-300 dark:border-zinc-700'">
          <button
            type="button"
            :title="`${stat.description ?? ''} · ${stat.grain}-grain${stat.cached ? ' · cached' : ''}`"
            :aria-pressed="selected.includes(stat.code)"
            :data-testid="`stat-${stat.code}`"
            class="px-2 py-0.5 text-xs"
            :class="selected.includes(stat.code) ? 'font-medium' : 'text-zinc-500'"
            @click="emit('toggle', stat.code)"
          >
            {{ stat.label }}
          </button>
          <button
            type="button"
            :aria-label="`what ${stat.label} counts`"
            :data-testid="`define-${stat.code}`"
            class="border-l border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            @click="emit('describe', stat.code)"
          >
            ?
          </button>
        </span>
      </div>
    </div>

    <p v-if="groups.length === 0" class="text-sm text-zinc-500" data-testid="stat-none">
      No stat can be measured on this situation — it is answered on {{ where }}.
    </p>

    <p v-if="hidden > 0" class="text-xs text-zinc-500" data-testid="stat-hidden">
      {{ hidden }} stat{{ hidden === 1 ? '' : 's' }} hidden: this situation and grouping are answered on {{ where }}, and those are measured elsewhere.
    </p>

    <p v-if="dropped.length" role="alert" data-testid="stat-dropped" class="text-xs text-amber-700 dark:text-amber-400">
      Dropped from the report because the situation no longer supports {{ dropped.length === 1 ? 'it' : 'them' }}: {{ dropped.join(', ') }}.
    </p>
  </section>
</template>
