<script setup lang="ts">
// Step 3 — put the board out and count what each range actually hit (spec §15.3). The two
// distributions sit side by side because the answer to "who liked this flop" is the comparison,
// not either column on its own.
import type { Axis } from '@poker/core';
import { cardToString } from '@poker/core';
import { BoardSelector, ComboDistributionPanel, explainHitShares } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { workPatch } from '~/analyze/context';
import { asPercent, isDealt, topPairOrBetterShare } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(3);

/**
 * How the two trees are grouped — the reader's choice, and one choice for both (ADR-074).
 *
 * It was a literal `['made', 'draw']` passed to each panel with no listener, so all four axis
 * checkboxes ticked and nothing regrouped, and Export CSV did nothing at all: the audit's
 * "controls that render editable and do nothing", the same defect F.12 fixed on the replayer.
 * The two panels share one value because the step is the comparison — two trees cut differently
 * are not side by side in any useful sense. The `strategic` and `nut` axes need per-combo
 * equities, which this step does not compute; the panel says so in its own words and offers the
 * way back, which is what a checkbox that cannot be honoured should do.
 */
const axes = ref<Axis[]>(['made', 'draw']);
/** A download is inert in this app's sandbox, so Export hands the text back, as `/lab` does. */
const exported = ref('');

const board = computed(() => props.ctx.spot.board);

/**
 * The axes are the reader's choice and survive a change of board; the exported text is about the
 * board it was taken on, so it must not sit under the next one — the same rule the replayer keeps
 * across a step (`HandStudy.vue#onNode`). Dealing a new flop here is this step's own control, so
 * the stale window is inside the step rather than between steps, and nothing else closes it: the
 * reader never leaves, so no remount resets it.
 */
watch(board, () => (exported.value = ''));

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
        <ComboDistributionPanel :range="ctx.spot.hero" :board="board" :group-by="axes" @update:group-by="axes = $event" @export="exported = $event" />
      </div>
      <div v-if="ctx.spot.villain" class="space-y-2">
        <p class="text-sm font-medium">Their range</p>
        <ComboDistributionPanel :range="ctx.spot.villain" :board="board" :group-by="axes" @update:group-by="axes = $event" @export="exported = $event" />
      </div>
    </div>

    <details v-if="exported" class="text-sm" data-testid="step3-export">
      <summary class="cursor-pointer text-zinc-500">Exported text</summary>
      <pre class="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{{ exported }}</pre>
    </details>

    <p v-if="comparison" class="text-sm" data-testid="step3-comparison">{{ comparison }}</p>

    <p v-if="isDealt(board) && !ctx.spot.villain" class="text-sm text-zinc-500" data-testid="step3-no-range">
      No range assigned to the other seat yet — step 1 is where that happens.
    </p>
  </StepShell>
</template>
