<script setup lang="ts">
/**
 * Build a situation out of the registry (plan D.3, §2.5).
 *
 * Every dimension the server declares is reachable here: the families of `~/stats/families` are
 * the order a hand is thought about, the search box is the way in when you already know the
 * name, and anything the registry grows that nobody has classified yet still appears, under
 * "Other". The output is the shared filter store's clause list — this component owns no state
 * of its own beyond which family is open and what has been typed in the search box.
 *
 * Each column's own sentence rides on its button through `RegistryTerm`'s trigger slot (ADR-057):
 * the button stays the button — same testid, same click — and only gains an explanation that a
 * keyboard and a finger can reach, which the `title` it replaces never was. The tables behind a
 * column are named the way the screen names them ("hands", "decisions"), not as `player_hands`.
 */
import { computed, ref } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import type { Dimension } from '~/stats/api';
import { dimensionEntry } from '~/stats/vocabulary';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import ClauseRow from './ClauseRow.vue';

const definitions = useDefinitionsStore();
const filter = useFilterStore();

const search = ref('');
const open = ref<string | null>(null);

const used = computed(() => new Set(filter.clauses.map((clause) => clause.dim)));

const groups = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (needle === '') return definitions.groups;
  return definitions.groups
    .map((group) => ({ ...group, dimensions: group.dimensions.filter((dim) => matches(dim, needle)) }))
    .filter((group) => group.dimensions.length > 0);
});

function matches(dim: Dimension, needle: string): boolean {
  return dim.label.toLowerCase().includes(needle) || dim.code.includes(needle) || dim.description.toLowerCase().includes(needle);
}

/** Searching flattens the accordion: with a needle typed, every matching family is open. */
function isOpen(name: string): boolean {
  return search.value.trim() !== '' || open.value === name;
}

function add(dim: Dimension): void {
  filter.add(dim);
  search.value = '';
}
</script>

<template>
  <section class="space-y-3" data-testid="situation-builder">
    <div v-if="definitions.status === 'error'" role="alert" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline" @click="definitions.load()">Try again</button>
    </div>
    <p v-else-if="definitions.status !== 'ready'" class="text-sm text-zinc-500">Loading the registry…</p>

    <template v-else>
      <ul v-if="filter.clauses.length" class="rounded-lg border border-zinc-200 px-3 dark:border-zinc-800" data-testid="clause-list">
        <ClauseRow
          v-for="(clause, index) in filter.clauses"
          :key="`${clause.dim}-${index}`"
          :clause="clause"
          :dim="definitions.byCode.get(clause.dim)"
          @change="filter.replace(index, $event)"
          @remove="filter.remove(index)"
        />
      </ul>
      <p v-else class="text-sm text-zinc-500" data-testid="clause-list-empty">No conditions yet — every hand is included. Add one below.</p>

      <input
        v-model="search"
        type="search"
        placeholder="Search all dimensions — texture, stack, facing…"
        aria-label="search dimensions"
        data-testid="dimension-search"
        class="w-full rounded border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
      />

      <div class="space-y-1">
        <div v-for="group in groups" :key="group.name" class="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
            :aria-expanded="isOpen(group.name)"
            :data-testid="`family-${group.name}`"
            @click="open = open === group.name ? null : group.name"
          >
            <span>{{ group.name }}</span>
            <span class="text-xs font-normal text-zinc-500">{{ group.hint }}</span>
            <span class="ml-auto text-xs text-zinc-500">{{ group.dimensions.length }}</span>
          </button>
          <div v-if="isOpen(group.name)" class="flex flex-wrap gap-1 px-3 pb-3">
            <RegistryTerm v-for="dim in group.dimensions" :key="dim.code" :entry="dimensionEntry(dim, dim.code)">
              <template #default="{ describedby }">
                <button
                  type="button"
                  :aria-describedby="describedby"
                  :data-testid="`add-${dim.code}`"
                  class="rounded border px-2 py-0.5 text-xs"
                  :class="used.has(dim.code) ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-300 dark:border-zinc-700'"
                  @click="add(dim)"
                >
                  {{ dim.label }}
                </button>
              </template>
            </RegistryTerm>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
