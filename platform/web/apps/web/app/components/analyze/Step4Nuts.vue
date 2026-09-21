<script setup lang="ts">
// Step 4 — who holds the hands that never fold (spec §15.4). Range advantage buys frequency;
// nut advantage buys size, and the split is the number that decides how big to bet.
import type { EquityResult, NutOptions } from '@poker/core';
import { DEFAULT_NUT_CUTOFF, DEFAULT_NUT_TOP_PERCENT, nutAdvantage } from '@poker/core';
import { EquityCalculator, RangeComparisonPanel } from '@poker/ui';
import { computed, ref, shallowRef } from 'vue';

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
/** What counts as nutted — set in the panel's Advanced fold, and the definition the prediction is graded by. */
const nut = ref<Required<NutOptions>>({ mode: 'cutoff', cutoff: DEFAULT_NUT_CUTOFF, topPercent: DEFAULT_NUT_TOP_PERCENT });

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
    nut.value,
  );
  return asPercent(split.split.hero);
});
/**
 * Once the prediction is committed, the definition it is graded by stays put: changing it afterwards
 * would re-grade an answer already given. It is not saved with the analysis (StepWork has no field
 * for it — ADR-053), so a reopened analysis grades by the default again, and the sentence says so.
 */
const LOCKED = `Fixed now that your answer is committed: this definition is the one it is graded by. It is not saved with the analysis, so reopening grades by the default (equity at or above ${asPercent(DEFAULT_NUT_CUTOFF)}%).`;
const committed = computed(() => props.ctx.step.prediction !== null);
const nutLockedReason = computed(() => (committed.value ? LOCKED : ''));

/**
 * The nut split *is* this step's question, and the panel printed it beside the gate that asks for
 * it (ADR-061). It is withheld until the answer is committed — the same rule `StepShell` keeps for
 * `actual`, and the one steps 3, 6 and 9 already keep for their own reveals.
 *
 * The equity **bands** go with it: the top band is 80–100%, which is the nutted set at the default
 * definition, and each side's band carries its weighted combos in a tooltip — so the two together
 * are the graded number, one hover away. The equities, the range advantage and the distribution
 * stay on screen: they are the work, not the answer. The Advanced fold stays open too, because the
 * definition is chosen before the answer.
 */
const HIDDEN =
  'This is what the step asks you for — and so are the equity bands, whose top band is the nutted set at the current definition. Commit your answer below and both appear here.';
const nutHiddenReason = computed(() => (committed.value ? '' : HIDDEN));

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
        v-model:nut-options="nut"
        :nut-locked-reason="nutLockedReason"
        :nut-hidden-reason="nutHiddenReason"
        :hero="both[0]!"
        :villain="both[1]!"
        :hero-equities="result?.perComboEquity ?? null"
        :villain-equities="result?.perComboEquityVillain ?? null"
        :exact="result?.exact ?? null"
      />
    </template>
  </StepShell>
</template>
