<script setup lang="ts">
// Step 4 — who holds the hands that never fold (spec §15.4). Range advantage buys frequency;
// nut advantage buys size, and the split is the number that decides how big to bet.
import type { EquityResult } from '@poker/core';
import { nutAdvantage } from '@poker/core';
import { EquityCalculator, RangeComparisonPanel } from '@poker/ui';
import { computed, shallowRef } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { asPercent } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(4);
const { service } = useEquityService();
const result = shallowRef<EquityResult | null>(null);

const both = computed(() => {
  const { hero, villain } = props.ctx.spot;
  return hero !== null && villain !== null ? [hero, villain] : [];
});

/** The nut split, once the equity engine has answered — the number the prediction is scored on. */
const actual = computed(() => {
  const equities = result.value;
  const [hero, villain] = both.value;
  if (equities === null || hero === undefined || villain === undefined) return null;
  const split = nutAdvantage(
    { equities: equities.perComboEquity, weights: hero.weights },
    { equities: equities.perComboEquityVillain, weights: villain.weights },
  );
  return asPercent(split.split.hero);
});
const unavailable = computed(() =>
  both.value.length < 2 ? 'Both seats need a range before the nuts can be counted — steps 1 and 2.' : '',
);
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <p v-if="both.length < 2" class="text-sm text-zinc-500" data-testid="step4-no-ranges">
      Both seats need a range before the nuts can be counted — steps 1 and 2.
    </p>
    <template v-else>
      <EquityCalculator :ranges="both" :board="ctx.spot.board" :service="service" @result="result = $event" />
      <RangeComparisonPanel
        :hero="both[0]!"
        :villain="both[1]!"
        :hero-equities="result?.perComboEquity ?? null"
        :villain-equities="result?.perComboEquityVillain ?? null"
        :exact="result?.exact ?? null"
      />
    </template>
  </StepShell>
</template>
