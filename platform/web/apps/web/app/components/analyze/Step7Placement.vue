<script setup lang="ts">
// Step 7 — the same hand is a bet, a check or a give-up depending on what is around it
// (spec §15.7). The matrix rings your combo inside your own range; the reveal says where it
// actually sits by made-hand class and what that makes it — a rule of thumb, and labelled as one.
// The class is printed with the classifier's own word and its rule on hover (ADR-056), and "a real
// draw" is explained by the draws that count, so nothing in the sentence is left undefined.
import { cardToString, classifyHand, comboIndex } from '@poker/core';
import { AXIS_WORDS, MADE_HAND_WORDS, REAL_DRAW, RangeMatrix, TermLabel } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { asPercent, classPercentile, isDealt, roleOf } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(7);
const HOLE_CARDS = 2;

const hole = computed(() => props.ctx.spot.heroCards);
const highlight = computed(() =>
  hole.value.length === HOLE_CARDS ? [comboIndex(hole.value[0]!, hole.value[1]!)] : null,
);

const classification = computed(() => {
  if (hole.value.length !== HOLE_CARDS || !isDealt(props.ctx.spot.board)) return null;
  return classifyHand([hole.value[0]!, hole.value[1]!], props.ctx.spot.board);
});

const percentile = computed(() => {
  const hero = props.ctx.spot.hero;
  return hero === null ? null : classPercentile(hero, props.ctx.spot.board, hole.value);
});

const actual = computed(() => {
  const where = percentile.value;
  const what = classification.value;
  if (where === null || what === null) return null;
  return roleOf(where, what.made, what.draws);
});

// The answer itself is the prediction; nothing extra is stored on the step's work here.
const committed = computed(() => props.ctx.step.prediction !== null);
/** Three different reasons there is nothing to place, and each says which one it is. */
const unavailable = computed(() => {
  if (actual.value !== null) return '';
  if (hole.value.length !== HOLE_CARDS) return 'Pick the hand you were holding in step 5.';
  if (props.ctx.spot.hero === null) return 'Give yourself a range in step 1.';
  if (!isDealt(props.ctx.spot.board)) return 'Deal the board in step 3.';
  return `${hole.value.map(cardToString).join('')} is not in the range you gave yourself — add it in step 1, or pick the hand you actually held.`;
});
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <p v-if="hole.length !== HOLE_CARDS" class="text-sm text-zinc-500" data-testid="step7-no-hand">
      Your hand is picked in step 5.
    </p>
    <template v-else-if="ctx.spot.hero">
      <RangeMatrix :range="ctx.spot.hero" mode="view" :blocked-cards="ctx.spot.board" :highlight-combos="highlight" />
      <p v-if="committed && percentile !== null && classification" class="text-sm" data-testid="step7-placement">
        Your hand is <strong><TermLabel :entry="MADE_HAND_WORDS[classification.made]" :label="MADE_HAND_WORDS[classification.made].term.toLowerCase()" :name="classification.made" /></strong>,
        stronger than {{ asPercent(percentile) }}% of your own range by <TermLabel :entry="AXIS_WORDS.made" label="made-hand class" />.
        By the rule of thumb — the top of the range is value, a <TermLabel :entry="REAL_DRAW" label="real draw" /> below it is a
        semi-bluff — that makes it <strong>{{ actual }}</strong>. No solver was asked.
      </p>
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="step7-no-range">No range of your own yet — step 1.</p>
  </StepShell>
</template>
