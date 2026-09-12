<script setup lang="ts">
/**
 * One or two cohorts of the field, as grids (plan D.6's Done means).
 *
 * The grid is D.5's `StatGrid`, unmodified and unforked — ADR-042 made that a decision of record
 * ("*D.4 and D.6 inherit the rule by using `StatGrid`, rather than each re-deciding what 'enough'
 * means*"), and it is the component that already shows every cell's own `n` and dims a thin one.
 * All this adds is the pairing: two headed grids over rows `pool/compare.ts` has lined up, so the
 * fourth sizing bucket of one sits beside the fourth of the other.
 */
import StatGrid from '~/components/reports/StatGrid.vue';
import type { Dimension, ReportResult, Stat } from '~/stats/api';

const props = defineProps<{
  left: { label: string; result: ReportResult | null };
  /** The second cohort, or `null` when one cohort was asked about. */
  right: { label: string; result: ReportResult | null } | null;
  stats: readonly Stat[];
  dimensions: ReadonlyMap<string, Dimension>;
  minN: number;
}>();

const emit = defineEmits<{ describe: [code: string] }>();

/** How many of the field's hands a side rests on, so a cohort's size is never implied by the grid. */
function hands(side: { result: ReportResult | null } | null): string {
  return side?.result == null ? '' : `${side.result.hands.toLocaleString('en-US')} hands`;
}
</script>

<template>
  <div :class="props.right === null ? 'space-y-3' : 'grid gap-4 lg:grid-cols-2'" data-testid="cohort-grids">
    <section class="space-y-2 min-w-0">
      <h2 class="flex flex-wrap items-baseline gap-2 text-sm font-medium">
        <span data-testid="grid-left-label">{{ props.left.label }}</span>
        <span class="text-xs font-normal text-zinc-500 tabular-nums" data-testid="grid-left-hands">{{ hands(props.left) }}</span>
      </h2>
      <StatGrid :result="props.left.result" :stats="props.stats" :dimensions="props.dimensions" :min-n="props.minN" @describe="emit('describe', $event)" />
    </section>

    <section v-if="props.right" class="space-y-2 min-w-0">
      <h2 class="flex flex-wrap items-baseline gap-2 text-sm font-medium">
        <span data-testid="grid-right-label">{{ props.right.label }}</span>
        <span class="text-xs font-normal text-zinc-500 tabular-nums" data-testid="grid-right-hands">{{ hands(props.right) }}</span>
      </h2>
      <StatGrid :result="props.right.result" :stats="props.stats" :dimensions="props.dimensions" :min-n="props.minN" @describe="emit('describe', $event)" />
    </section>
  </div>
</template>
