<script setup lang="ts">
// Step 6 — the decision itself (spec §15.6): how often comes from range advantage, how big from
// nut advantage. You commit to bet or check and to a size, and only then does the field's own
// answer appear beside it. We structure the comparison; we do not generate a solver's answer.
import type { EquityResult } from '@poker/core';
import { rangeAdvantage } from '@poker/core';
import { EquityCalculator, NumberInput, PoolDataBadge, explainRangeAdvantage } from '@poker/ui';
import { computed, shallowRef } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { poolGap, workPatch } from '~/analyze/context';
import { asPercent } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(6);
const PERCENT = 100;
const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);
const { service } = useEquityService();
const result = shallowRef<EquityResult | null>(null);

const both = computed(() => {
  const { hero, villain } = props.ctx.spot;
  return hero !== null && villain !== null ? [hero, villain] : [];
});

const advantage = computed(() => {
  const equities = result.value;
  const [hero, villain] = both.value;
  if (equities === null || hero === undefined || villain === undefined) return null;
  return rangeAdvantage(
    { equities: equities.perComboEquity, weights: hero.weights },
    { equities: equities.perComboEquityVillain, weights: villain.weights },
  );
});

/**
 * The advantage in words, from the shared template so its verdict and its even-range margin are
 * the Lab's. The seats go by the names the calculator above prints, so the sentence and the
 * numbers name the same two ranges.
 */
const advantageText = computed(() => {
  const [hero, villain] = both.value;
  if (advantage.value === null) return '';
  return explainRangeAdvantage(advantage.value, hero?.label ?? 'Hero', villain?.label ?? 'Villain');
});

/** What the field does: the aggressive share against everything else. */
const actual = computed(() => {
  const pool = props.ctx.pool;
  if (pool === null || !pool.enough) return null;
  let bets = 0;
  for (const [action, share] of Object.entries(pool.frequencies)) if (AGGRESSIVE.has(action)) bets += share;
  return bets >= 1 - bets ? 'bet' : 'check';
});

const unavailable = computed(() => poolGap(props.ctx.pool));

const poolActions = computed(() => Object.entries(props.ctx.pool?.frequencies ?? {}).sort((a, b) => b[1] - a[1]));
const committed = computed(() => props.ctx.step.prediction !== null);

/** A stored share as its box shows it, in percent. Unrounded: rounding here would rewrite a `28.5` still being typed. */
function asTyped(share: number | null): number | null {
  return share === null ? null : share * PERCENT;
}

/** How often, typed in percent (0–100, which the box enforces) and stored as a share; an empty box is no answer. */
function setFrequency(percent: number | null): void {
  emit('patch', workPatch(props.ctx.step, { frequency: percent === null ? null : percent / PERCENT }));
}

/**
 * How big, typed in percent of the pot and stored as a share; an empty box is no answer. A size of
 * 0 is not a bet (the server refuses one), so it leaves the size that stood rather than clearing it
 * under the reader's cursor — `0` is also where `0.5` starts.
 */
function setSize(percent: number | null): void {
  if (percent === 0) return;
  emit('patch', workPatch(props.ctx.step, { size_pct: percent === null ? null : percent / PERCENT }));
}
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <template v-if="both.length === 2">
      <EquityCalculator :ranges="both" :board="ctx.spot.board" :service="service" @result="result = $event" />
      <p v-if="advantage" class="text-sm" data-testid="step6-advantage">{{ advantageText }}</p>
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="step6-no-ranges">Both seats need a range first.</p>

    <div class="flex flex-wrap items-end gap-4">
      <label class="text-sm">
        <span class="block">How often would you take this line?</span>
        <NumberInput :model-value="asTyped(ctx.step.work.frequency)" :min="0" :max="PERCENT" class="w-24 rounded border border-zinc-300 bg-transparent p-1 tabular-nums dark:border-zinc-700" data-testid="step6-frequency" @update:model-value="setFrequency" @clear="setFrequency(null)" />
        <span class="ml-1 text-zinc-500">%</span>
      </label>
      <label class="text-sm">
        <span class="block">And how big, as a share of the pot?</span>
        <NumberInput :model-value="asTyped(ctx.step.work.size_pct)" :min="0" class="w-24 rounded border border-zinc-300 bg-transparent p-1 tabular-nums dark:border-zinc-700" data-testid="step6-size" @update:model-value="setSize" @clear="setSize(null)" />
        <span class="ml-1 text-zinc-500">% of pot</span>
      </label>
    </div>

    <div v-if="committed && ctx.pool" class="space-y-1" data-testid="step6-pool">
      <p v-if="ctx.pool.enough" class="flex flex-wrap gap-x-3 text-sm">
        <span v-for="[action, share] in poolActions" :key="action" class="tabular-nums">
          <span class="text-zinc-500">{{ action }}</span> {{ asPercent(share) }}%
        </span>
      </p>
      <PoolDataBadge :tier="1" :sample-size="ctx.pool.sample_size" :enough="ctx.pool.enough" :min-n="ctx.pool.min_n" />
    </div>
  </StepShell>
</template>
