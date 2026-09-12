<script setup lang="ts">
/**
 * One headline number of My game (plan D.4): the figure, its confidence interval, the sample
 * both rest on, and what the field does in the same spot.
 *
 * **This is E.2's first real consumer.** `MetricValue` was built one step earlier precisely so
 * that this tile could not print a bare number: the band and the `n` are not decoration on the
 * figure, they are the difference between *-1.37 bb/100 over 19,802 hands* and *-1.37 bb/100
 * over 200*, which are the same point estimate and not the same claim.
 *
 * The tile itself decides nothing. `kpis.ts` chose the unit and the precision, `reports/cell.ts`
 * decided whether the sample is thin and whether the comparison may be drawn, and the server
 * decided the interval. What is left here is layout — and the one rule layout can still break:
 * the comparison line is rendered from `view.deltaText`, which is empty exactly when the delta
 * is withheld, so a thin cell or a count cannot grow a comparison by being styled.
 */
import { MetricValue } from '@poker/ui';

import type { KpiTileView } from '~/hero/kpis';

const props = defineProps<{ tile: KpiTileView }>();

/** Description, caveats and the typical band, as one hover string. Never invented here. */
function explain(tile: KpiTileView): string {
  const parts = [tile.description, tile.notes];
  if (tile.typical) parts.push(`Usually ${tile.typical[0]}–${tile.typical[1]}${tile.format.unit}.`);
  if (tile.view.note !== '') parts.push(tile.view.note);
  return parts.filter((part) => part !== '').join(' ');
}
</script>

<template>
  <div
    class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    :class="props.tile.view.thin ? 'opacity-60' : ''"
    :data-testid="`kpi-${props.tile.code}`"
  >
    <h3 class="text-xs font-medium text-zinc-500" :title="explain(props.tile)">
      {{ props.tile.label }}
      <span v-if="props.tile.view.thin" class="ml-1 text-amber-600 dark:text-amber-500" :data-testid="`kpi-thin-${props.tile.code}`">thin</span>
    </h3>

    <MetricValue
      class="mt-1"
      :value="props.tile.value"
      :low="props.tile.low"
      :high="props.tile.high"
      :n="props.tile.n"
      :unit="props.tile.format.unit"
      :digits="props.tile.format.digits"
      :level="props.tile.level"
      :signed="props.tile.format.signed"
      fixed
    />

    <p v-if="props.tile.view.baselineText !== ''" class="mt-1 text-xs text-zinc-500" :data-testid="`kpi-vs-${props.tile.code}`">
      the field {{ props.tile.view.baselineText }}
      <span
        v-if="props.tile.view.deltaText !== ''"
        class="ml-1 tabular-nums"
        :class="props.tile.view.deltaSense === 'bad' ? 'text-red-600 dark:text-red-400' : props.tile.view.deltaSense === 'good' ? 'text-emerald-600 dark:text-emerald-400' : ''"
        :data-testid="`kpi-delta-${props.tile.code}`"
      >{{ props.tile.view.deltaText }}</span>
    </p>
  </div>
</template>
