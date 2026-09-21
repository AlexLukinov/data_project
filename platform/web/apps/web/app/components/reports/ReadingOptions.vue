<script setup lang="ts">
/**
 * The three choices that change how a grid is read rather than what it counts (plan D.5).
 *
 * They travel together because they are the same question asked three ways — against what, below
 * what, and of whom — and because keeping them out of `ReportWorkbench` is what keeps that file
 * a shell. Neither of the two toggles changes the report: `compare` asks for a baseline beside each
 * cell, `minN` greys the cells whose sample is too small to read, and the cohort line only *says*
 * what the stored report already scopes itself to.
 *
 * That last line is the one this component exists for. It used to print the rules as the API sends
 * them — "vpip lt 25 and hands gte 1000" — so a standard pool report announced its own scope in
 * three kinds of code at once. `describeRules` reads the registry's labels and the cohort form's
 * own comparison words (ADR-057), so the note reads in the words the rule was built with.
 */
import { describeRules } from '~/pool/stats';
import { MIN_N_CHOICES } from '~/reports/cell';
import type { CohortSpec, Stat } from '~/stats/api';

const compare = defineModel<boolean>('compare', { required: true });
const minN = defineModel<number>('minN', { required: true });

const props = defineProps<{
  /** Whether a baseline is actually in effect, as opposed to merely remembered. */
  compareOn: boolean;
  /** The rules a stored report scopes itself to, or `null` when it scopes itself to nobody. */
  cohort: CohortSpec | null;
  cohortOn: boolean;
  /** The registry's stats, for the labels the rules are named by. */
  stats: readonly Stat[];
}>();
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
    <h2 class="text-sm font-medium">How to read it</h2>
    <label class="flex flex-wrap items-center gap-2 text-sm">
      <input v-model="compare" type="checkbox" data-testid="compare-toggle" />
      <span>Compare each cell with the field</span>
      <span v-if="compare && !props.compareOn" class="text-xs text-amber-700 dark:text-amber-400" data-testid="compare-inert">
        remembered, but not in effect on a pool report — there is no hero seat to compare
      </span>
    </label>
    <label class="flex items-center gap-2 text-sm">
      <span class="text-zinc-500">grey a cell under</span>
      <select v-model.number="minN" data-testid="minn-select" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700">
        <option v-for="choice in MIN_N_CHOICES" :key="choice" :value="choice">{{ choice === 0 ? 'never — show every number' : `${choice} observations` }}</option>
      </select>
    </label>
    <p v-if="props.cohortOn && props.cohort" class="text-xs text-zinc-500" data-testid="cohort-note">
      Scoped to players whose {{ describeRules(props.cohort, props.stats) }}.
    </p>
  </section>
</template>
