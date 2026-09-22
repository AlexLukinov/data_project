<script setup lang="ts">
// Step 5 — your own two cards, and exactly which of their combos those cards kill (spec §15.5).
// The question the board decides: on a two-tone flop the useful count is their flush draws, on a
// rainbow one it is how much your hand removed at all.
import type { Card } from '@poker/core';
import { cardToString, comboIndex, createRange } from '@poker/core';
import { BlockerPanel, CardBlockerHeatmap, CardPicker } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { workPatch } from '~/analyze/context';
import { combosRemoved, flushDrawCombos, isDealt } from '~/analyze/reveals';
import { blockerQuestion, stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(5);
const HOLE_CARDS = 2;
/** The blocker panel splits villain's range into what calls and what folds; here it all calls. */
const NOTHING = createRange(undefined, 'folds');

const hole = computed(() => props.ctx.spot.heroCards);
const question = computed(() => blockerQuestion(props.ctx.spot.board));
const asksAboutDraws = computed(() => question.value.question.includes('flush draws'));

function toggle(card: Card): void {
  const held = hole.value.includes(card) ? hole.value.filter((c) => c !== card) : [...hole.value, card];
  const kept = held.slice(-HOLE_CARDS);
  emit('patch', workPatch(props.ctx.step, { hero_cards: kept.map(cardToString).join('') }));
}

const heroCombo = computed(() => (hole.value.length === HOLE_CARDS ? comboIndex(hole.value[0]!, hole.value[1]!) : null));
/**
 * The panel's per-hand line — "kills N of villain's calls" — is this step's graded answer on a
 * rainbow board, where the question is how much the hand removed at all. It is handed the combo
 * only once the prediction is committed, the same rule step 4 keeps (ADR-061); the heatmap and the
 * table above it are the work and stay. On a two-tone board the question is about flush draws,
 * which the panel does not count, but the line is gated either way rather than by board texture.
 */
const selectedCombo = computed(() => (props.ctx.step.prediction === null ? null : heroCombo.value));

const actual = computed(() => {
  const villain = props.ctx.spot.villain;
  if (villain === null || hole.value.length !== HOLE_CARDS) return null;
  const count = asksAboutDraws.value
    ? flushDrawCombos(villain, props.ctx.spot.board, hole.value)
    : combosRemoved(villain, props.ctx.spot.board, hole.value);
  return count.toFixed(0);
});
const unavailable = computed(() =>
  actual.value === null ? 'Pick your two cards above, and give the other seat a range in step 1.' : '',
);
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :question="question" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <CardPicker :selected="hole" :disabled="ctx.spot.board" label="your hand" @toggle="toggle" />
    <p v-if="heroCombo === null" class="text-sm text-zinc-500" data-testid="step5-no-hand">Pick your two cards above.</p>

    <template v-else-if="ctx.spot.villain && isDealt(ctx.spot.board)">
      <CardBlockerHeatmap :villain-range="ctx.spot.villain" :board="ctx.spot.board" />
      <BlockerPanel
        :hero-range="ctx.spot.hero ?? ctx.spot.villain"
        :villain-call="ctx.spot.villain"
        :villain-fold="NOTHING"
        :selected-combo="selectedCombo"
        :board="ctx.spot.board"
      />
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="step5-no-range">No range for the other seat yet — step 1.</p>
  </StepShell>
</template>
