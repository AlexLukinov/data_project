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
 *
 * **Three words on this tile now explain themselves** (ADR-057): the stat's own label, "thin", and
 * "the field". All three were `title` text or nothing at all, and `title` is a mouse affordance —
 * no keyboard, no touch — on the tile a first-time reader meets before anything else.
 *
 * Which is why a thin tile dims its numbers and not itself. `opacity` on the wrapper would fade the
 * three tips with it — including the one explaining why the tile is faded — and, worse, make the
 * tile a stacking context the tip's `z-index` cannot escape, so it would be painted over by the
 * next tile along. Only what is actually unreliable is dimmed: the figure and the comparison.
 */
import { MetricValue } from '@poker/ui';
import { computed } from 'vue';

import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import type { KpiTileView } from '~/hero/kpis';
import { thinTerm } from '~/hero/kpis';
import { APP_TERMS } from '~/stats/vocabulary';

const props = defineProps<{ tile: KpiTileView }>();

/** "the field" is the app's word, not the registry's, so it comes from the app's own list. */
const FIELD = APP_TERMS.field;

const thin = computed(() => thinTerm(props.tile.view));
/** Too few hands to read: the numbers are faded, the words that explain them are not. */
const dimmed = computed(() => (props.tile.view.thin ? 'opacity-60' : ''));
</script>

<template>
  <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" :data-testid="`kpi-${props.tile.code}`">
    <h3 class="text-xs font-medium text-zinc-500">
      <RegistryTerm :entry="props.tile.term" :label="props.tile.label" :name="props.tile.code" />
      <RegistryTerm v-if="props.tile.view.thin" :entry="thin" class="ml-1 text-amber-600 dark:text-amber-500">
        <template #default="{ describedby }">
          <span class="pk-term-text" tabindex="0" :aria-describedby="describedby" :data-term="thin.term" :data-testid="`kpi-thin-${props.tile.code}`">{{ thin.term }}</span>
        </template>
      </RegistryTerm>
    </h3>

    <MetricValue
      class="mt-1"
      :class="dimmed"
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
      <RegistryTerm :entry="FIELD" /> <span :class="dimmed">{{ props.tile.view.baselineText }}</span>
      <span
        v-if="props.tile.view.deltaText !== ''"
        class="ml-1 tabular-nums"
        :class="[dimmed, props.tile.view.deltaSense === 'bad' ? 'text-red-600 dark:text-red-400' : props.tile.view.deltaSense === 'good' ? 'text-emerald-600 dark:text-emerald-400' : '']"
        :data-testid="`kpi-delta-${props.tile.code}`"
      >{{ props.tile.view.deltaText }}</span>
    </p>
  </div>
</template>
