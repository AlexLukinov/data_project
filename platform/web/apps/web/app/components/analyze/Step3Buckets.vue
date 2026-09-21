<script setup lang="ts">
// Step 3 — put the board out and count what each range actually hit (spec §15.3). The two
// distributions sit side by side because the answer to "who liked this flop" is the comparison,
// not either column on its own.
import { cardToString } from '@poker/core';
import { BoardSelector, ComboDistributionPanel, explainHitShares } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { workPatch } from '~/analyze/context';
import { asPercent, isDealt, topPairOrBetterShare } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(3);
const GROUP_BY = ['made', 'draw'] as const;

const board = computed(() => props.ctx.spot.board);

function setBoard(cards: readonly number[]): void {
  emit('patch', workPatch(props.ctx.step, { board: cards.map(cardToString).join(' ') }));
}

const actual = computed(() => {
  const villain = props.ctx.spot.villain;
  if (villain === null || !isDealt(board.value)) return null;
  return asPercent(topPairOrBetterShare(villain, board.value));
});
const unavailable = computed(() =>
  actual.value === null ? 'Deal a board above and give the other seat a range in step 1, and this can be counted.' : '',
);

/**
 * The comparison the columns are for, in words — and only once the prediction is committed: the
 * sentence carries villain's top-pair-or-better share, which is the answer to this step's question.
 */
const comparison = computed(() => {
  const { hero, villain } = props.ctx.spot;
  if (props.ctx.step.prediction === null || hero === null || villain === null || !isDealt(board.value)) return '';
  return explainHitShares(topPairOrBetterShare(hero, board.value), topPairOrBetterShare(villain, board.value), 'your range', 'their range');
});
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <BoardSelector :board="board" :dead-cards="[]" @update:board="setBoard" />

    <p v-if="!isDealt(board)" class="text-sm text-zinc-500" data-testid="step3-no-board">
      Deal the flop above — from the hand you are studying, or any board you want to test.
    </p>

    <div v-else class="grid gap-6 lg:grid-cols-2">
      <div v-if="ctx.spot.hero" class="space-y-2">
        <p class="text-sm font-medium">Your range</p>
        <ComboDistributionPanel :range="ctx.spot.hero" :board="board" :group-by="GROUP_BY" />
      </div>
      <div v-if="ctx.spot.villain" class="space-y-2">
        <p class="text-sm font-medium">Their range</p>
        <ComboDistributionPanel :range="ctx.spot.villain" :board="board" :group-by="GROUP_BY" />
      </div>
    </div>

    <p v-if="comparison" class="text-sm" data-testid="step3-comparison">{{ comparison }}</p>

    <p v-if="isDealt(board) && !ctx.spot.villain" class="text-sm text-zinc-500" data-testid="step3-no-range">
      No range assigned to the other seat yet — step 1 is where that happens.
    </p>
  </StepShell>
</template>
