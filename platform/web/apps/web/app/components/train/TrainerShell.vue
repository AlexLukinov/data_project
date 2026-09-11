<script setup lang="ts">
// The chrome every one of the six training modes shares (spec §16): the situation, the mode's own
// work in the slot, one prediction gate per question, and the reveal panel underneath.
//
// The gate is only ever handed an answer once one has been committed — the same rule the analyzer
// keeps (ADR-034), and here it is the trainer session that enforces it: `truth` is empty until
// `commit` has fired for every question on the spot.
import type { PredictionOutcome } from '@poker/ui';
import { PredictionGate } from '@poker/ui';
import { computed } from 'vue';

import type { Trainer } from '~/train/session';
import type { TrainSpot } from '~/train/types';

const props = defineProps<{
  trainer: Trainer;
  /** The mode's own verdict number, when it has one: the drawing mode's weight error. */
  weightError?: number | null;
}>();

// Declared so the mode components get a spot that is known not to be null.
defineSlots<{
  default(props: { spot: TrainSpot; revealed: boolean }): unknown;
  reveal(props: { spot: TrainSpot }): unknown;
}>();

const spot = computed(() => props.trainer.spot.value);
const questions = computed(() => spot.value?.questions ?? []);
const revealed = computed(() => props.trainer.status.value === 'revealed');

/**
 * Which questions are open. The second question of a two-part spot only appears once the first
 * has an answer, so committing to the nut split cannot be informed by having seen the first
 * reveal — there is nothing to reveal until both are in.
 */
const shown = computed(() =>
  questions.value.filter(
    (question, at) => at === 0 || (props.trainer.given.value[questions.value[at - 1]!.key] ?? '') !== '',
  ),
);

function committedFor(key: string): string | null {
  const given = props.trainer.given.value[key] ?? '';
  return given === '' ? null : given;
}

/** The truth for one question, or `null` while it is still being worked out. */
function actualFor(key: string): string | null {
  return props.trainer.truth.value[key] ?? null;
}

function onSubmit(key: string, answer: string): void {
  props.trainer.commit(key, answer);
}

function onReveal(key: string, outcome: PredictionOutcome): void {
  void props.trainer.settle(key, outcome, props.weightError ?? null);
}
</script>

<template>
  <section v-if="spot" class="space-y-4">
    <header class="flex flex-wrap items-center gap-3">
      <h2 class="text-lg font-semibold" data-testid="spot-label">{{ spot.label }}</h2>
      <span
        v-if="trainer.repeat.value"
        class="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400"
        data-testid="spot-repeat"
      >
        Back for review
      </span>
      <span class="ml-auto text-sm text-zinc-500 tabular-nums" data-testid="run-score">
        {{ trainer.right.value }} / {{ trainer.served.value }} right
        <template v-if="trainer.due.value > 0"> · {{ trainer.due.value }} owed</template>
      </span>
    </header>

    <div class="space-y-4"><slot :spot="spot" :revealed="revealed" /></div>

    <PredictionGate
      v-for="question in shown"
      :key="question.key"
      :question="question.question"
      :answer-type="question.answerType"
      :tolerance="question.tolerance"
      :choices="question.choices"
      :unit="question.unit"
      :hint="question.hint"
      :committed="committedFor(question.key)"
      :actual="actualFor(question.key)"
      :unavailable="trainer.unavailable.value"
      @submit="onSubmit(question.key, $event)"
      @reveal="onReveal(question.key, $event)"
    />

    <div v-if="revealed" class="space-y-4">
      <slot name="reveal" :spot="spot" />
      <button
        type="button"
        class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        data-testid="next-spot"
        @click="trainer.next()"
      >
        Next spot →
      </button>
    </div>
  </section>
</template>
