<script setup lang="ts">
/**
 * The report as a grid: one row per group, one column per stat (plan D.5).
 *
 * **Every cell shows its own `n`.** Not in a tooltip, not only on the row — in the cell, under the
 * value, always. A row of 2,219 flops carries cells of n = 3, because each stat counts only the
 * decisions where its own situation arose, so the row's count cannot stand in for the cell's.
 *
 * A cell under the threshold is drawn dimmer than the muted text around it and its comparison with
 * the field is withheld. The rule itself lives in `reports/cell.ts`, tested there against real rows
 * from the founder's own database; this component only renders what it is told, which is why the
 * one place that decides "is this number worth reading" is also the one place that is tested.
 *
 * A per-cell `PoolDataBadge` was considered and rejected: it is the right control for one headline
 * figure, and it is tier-flavoured for the pool's node answers, but 13 rows by 8 columns of badges
 * would be a hundred paragraphs where the report wants a hundred numbers.
 */
import { computed } from 'vue';

import { cellView, formatGroupValue, formatN } from '~/reports/cell';
import type { Dimension, ReportResult, Stat } from '~/stats/api';

const props = defineProps<{
  result: ReportResult | null;
  /** The registry's stats, for the format, the direction and the description of each column. */
  stats: readonly Stat[];
  dimensions: ReadonlyMap<string, Dimension>;
  minN: number;
}>();

const emit = defineEmits<{ describe: [code: string] }>();

const byCode = computed(() => new Map(props.stats.map((stat) => [stat.code, stat])));

/** The registry's own label for a group-by column, falling back to the code it was asked by. */
function groupLabel(code: string): string {
  return props.dimensions.get(code)?.label ?? code;
}

/**
 * The stat behind a column. `StatMeta` carries the label and the format but not
 * `higher_is_better`, `typical` or `notes`, so the registry entry is joined in by code.
 */
function statOf(code: string): Stat {
  return byCode.value.get(code) ?? ({ code, label: code, category: 'money', grain: 'decision', format: 'percent' } as Stat);
}

function view(row: ReportResult['rows'][number], code: string) {
  return cellView(row.cells[code], statOf(code), props.minN);
}

const SENSE_CLASS: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  '': 'text-zinc-500',
};

/** How many cells the threshold is holding back — the honest headline for a thin report. */
const thin = computed(() => {
  const result = props.result;
  if (result === null) return 0;
  let count = 0;
  for (const row of result.rows) {
    for (const meta of result.stats) if (view(row, meta.code).thin) count += 1;
  }
  return count;
});

const total = computed(() => (props.result === null ? 0 : props.result.rows.length * props.result.stats.length));

/**
 * Whether to show the row's own hand count as a column of its own.
 *
 * Not when a count stat is already a column: the `preflop_overview` preset asks for `hands`, and
 * printing it twice — once as the founder's chosen column and once as the grid's own — is a
 * duplicate that makes a wide report wider for nothing. Theirs wins; mine is the uninvited one.
 */
const showHands = computed(() => props.result !== null && !props.result.stats.some((meta) => meta.format === 'count'));
</script>

<template>
  <div v-if="result" class="space-y-2" data-testid="stat-grid">
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <p class="border-b border-zinc-200 p-2 text-xs text-zinc-500 dark:border-zinc-800" data-testid="grid-meta">
        {{ formatN(result.hands) }} hands · {{ result.rows.length }} row{{ result.rows.length === 1 ? '' : 's' }} ·
        {{ result.stats.length }} stat{{ result.stats.length === 1 ? '' : 's' }} ·
        {{ result.cached ? 'from cache' : 'fresh' }}
      </p>

      <table class="w-full text-sm">
        <thead class="text-left text-xs text-zinc-500">
          <tr>
            <th v-for="key in result.group_by" :key="key" class="p-2" :data-testid="`grid-group-${key}`">{{ groupLabel(key) }}</th>
            <th v-if="result.group_by.length === 0" class="p-2">All hands</th>
            <th v-if="showHands" class="p-2 text-right" title="Hands covered by this row. Approximate on a decision-grain report, where it is counted by sketch.">hands</th>
            <th v-for="meta in result.stats" :key="meta.code" class="p-2 text-right">
              <button
                type="button"
                class="underline decoration-dotted underline-offset-2"
                :title="`${meta.description} — what it counts`"
                :data-testid="`grid-head-${meta.code}`"
                @click="emit('describe', meta.code)"
              >
                {{ meta.label }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in result.rows"
            :key="index"
            class="border-t border-zinc-200 dark:border-zinc-800"
            :data-testid="`grid-row-${result.group_by.map((k) => row.group[k]).join('-') || 'all'}`"
          >
            <td v-for="key in result.group_by" :key="key" class="p-2 font-medium">{{ formatGroupValue(row.group[key] ?? null) }}</td>
            <td v-if="result.group_by.length === 0" class="p-2 font-medium">All</td>
            <td v-if="showHands" class="p-2 text-right tabular-nums text-zinc-500">{{ formatN(row.hands) }}</td>

            <td
              v-for="meta in result.stats"
              :key="meta.code"
              class="p-2 text-right tabular-nums"
              :title="view(row, meta.code).note"
              :data-thin="view(row, meta.code).thin ? 'true' : 'false'"
              :data-testid="`cell-${result.group_by.map((k) => row.group[k]).join('-') || 'all'}-${meta.code}`"
            >
              <span class="block" :class="view(row, meta.code).thin ? 'text-zinc-400 dark:text-zinc-600' : ''">{{ view(row, meta.code).text }}</span>
              <span class="block text-xs" :class="view(row, meta.code).thin ? 'text-amber-700 dark:text-amber-500' : 'text-zinc-500'" :data-testid="`n-${meta.code}`">
                n {{ view(row, meta.code).nText }}
              </span>
              <span
                v-if="view(row, meta.code).deltaText"
                class="block text-xs"
                :class="SENSE_CLASS[view(row, meta.code).deltaSense]"
                :data-testid="`delta-${meta.code}`"
                :title="`the field: ${view(row, meta.code).baselineText}`"
              >
                {{ view(row, meta.code).deltaText }}
              </span>
            </td>
          </tr>
          <tr v-if="result.rows.length === 0">
            <td class="p-2 text-zinc-500" :colspan="result.group_by.length + result.stats.length + (showHands ? 1 : 0)" data-testid="grid-empty">
              No rows. Nothing in the database matches this situation.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-zinc-500" data-testid="grid-legend">
      Every cell shows the sample it is computed from.
      <template v-if="thin > 0">
        <span class="text-amber-700 dark:text-amber-400" data-testid="grid-thin-count">
          {{ thin }} of {{ total }} cells are under {{ formatN(minN) }} observations</span>: shown dimmed, and not compared with the field.
      </template>
      <template v-else-if="minN > 0"> Every cell here clears {{ formatN(minN) }} observations. </template>
    </p>
  </div>
</template>
