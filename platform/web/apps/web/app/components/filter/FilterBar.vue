<script setup lang="ts">
/**
 * The filter, as every screen wears it (plan D.3): which body of hands, over what dates, in what
 * situation — with the situation stated as a sentence and editable in place.
 *
 * It reads and writes the one shared store, so two screens showing this bar are showing the same
 * filter, and the URL follows it (`useFilterUrl`). The bar itself holds only whether the builder
 * is open.
 */
import { computed, ref } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import { grainNote } from '~/filter/grain';
import { clauseLabel } from '~/filter/label';
import { dimensionEntry } from '~/stats/vocabulary';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import SituationBuilder from './SituationBuilder.vue';

const props = withDefaults(defineProps<{ datasets?: boolean; dates?: boolean }>(), { datasets: true, dates: true });

const definitions = useDefinitionsStore();
const filter = useFilterStore();
const editing = ref(false);

/**
 * A situation drawn from decision-grain columns cannot be measured by a hand-grain stat: the
 * router refuses the pair before it validates anything else. Saying so here costs nothing and
 * saves a 400 nobody can read. The words are `filter/grain.ts`'s, so they are tested as text.
 */
const note = computed(() => grainNote(filter.tables, definitions.stats));

/**
 * A chip is the one place a situation is read at a glance, so it carries the column's own
 * explanation. The remove button says the column's label — a screen reader used to hear
 * `opener_position`, which is a name only this codebase uses.
 */
const chips = computed(() =>
  filter.clauses.map((clause, index) => {
    const dim = definitions.byCode.get(clause.dim);
    return { key: `${clause.dim}-${index}`, code: clause.dim, index, label: clauseLabel(clause, dim), entry: dimensionEntry(dim, clause.dim) };
  }),
);
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="filter-bar">
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <div v-if="props.datasets" class="flex gap-2" role="group" aria-label="dataset">
        <button v-for="option in (['hero', 'population'] as const)" :key="option" type="button" :data-testid="`filter-dataset-${option}`" :aria-pressed="filter.dataset === option" class="border-b-2 px-1 py-1" :class="filter.dataset === option ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-transparent text-zinc-500'" @click="filter.dataset = option">{{ option === 'hero' ? 'My hands' : 'Pool' }}</button>
      </div>

      <template v-if="props.dates">
        <label class="flex items-center gap-1 text-zinc-500">from
          <input v-model="filter.dateFrom" type="date" data-testid="filter-from" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label class="flex items-center gap-1 text-zinc-500">to
          <input v-model="filter.dateTo" type="date" data-testid="filter-to" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
      </template>

      <button type="button" data-testid="filter-edit" class="ml-auto rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" :aria-expanded="editing" @click="editing = !editing">
        {{ editing ? 'Done' : 'Edit situation' }}
      </button>
      <button v-if="filter.clauses.length" type="button" data-testid="filter-clear" class="text-zinc-500 underline" @click="filter.clear()">clear</button>
    </div>

    <p class="text-sm" data-testid="filter-sentence"><span class="text-zinc-500">Showing:</span> {{ filter.sentence }}</p>

    <ul v-if="chips.length && !editing" class="flex flex-wrap gap-1" data-testid="filter-chips">
      <li v-for="chip in chips" :key="chip.key" class="flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700" :data-testid="`chip-${chip.code}`">
        <RegistryTerm :entry="chip.entry" :label="chip.label" :name="chip.code" />
        <button type="button" :aria-label="`remove ${chip.entry.term}`" :data-testid="`chip-remove-${chip.code}`" class="text-zinc-500" @click="filter.remove(chip.index)">×</button>
      </li>
    </ul>

    <p v-if="note" data-testid="filter-grain" class="text-xs text-amber-700 dark:text-amber-400">{{ note.lead }}<RegistryTerm v-if="note.term" :entry="note.term" />{{ note.tail }}</p>
    <p v-for="problem in filter.problems" :key="problem" role="alert" data-testid="filter-problem" class="text-xs text-amber-700 dark:text-amber-400">{{ problem }}</p>

    <SituationBuilder v-if="editing" />
  </section>
</template>
