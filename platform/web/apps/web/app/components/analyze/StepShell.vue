<script setup lang="ts">
// The chrome every one of the nine steps shares (spec §15): what this step is for, the work
// itself in the slot, the prediction gate, and the one line you write once you have seen the
// answer. Each step component supplies its own body and its own `actual` — and computes that
// `actual` only after the prediction is committed, which is what makes the gate mean anything.
import type { PredictionOutcome } from '@poker/ui';
import { PredictionGate } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep, Prediction } from '~/analyze/api';
import type { StepDef, StepQuestion } from '~/analyze/steps';

const props = withDefaults(
  defineProps<{
    step: AnalysisStep;
    def: StepDef;
    /** Overrides the definition's wording when the board decides the question (step 5). */
    question?: StepQuestion | null;
    /** The truth, computed by the step; `null` until it has been worked out. */
    actual?: string | null;
    /** Why this step has no truth to show — too little pool data, a range not yet drawn. */
    unavailable?: string;
  }>(),
  { question: null, actual: null, unavailable: '' },
);

const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const asked = computed<StepQuestion>(() => props.question ?? props.def);
const committed = computed(() => props.step.prediction?.answer ?? null);
// The gate is only ever handed the answer once there is a committed prediction to compare it to.
const truth = computed(() => (committed.value === null ? null : props.actual));

function onSubmit(answer: string): void {
  const prediction: Prediction = {
    question: asked.value.question,
    answer_type: props.def.answerType,
    answer,
    actual: '',
    error: null,
    within_tolerance: null,
    committed_at: new Date().toISOString(),
  };
  emit('patch', { prediction });
}

function onReveal(outcome: PredictionOutcome): void {
  const prediction = props.step.prediction;
  if (prediction === null || prediction.actual === outcome.actual) return;
  emit('patch', {
    prediction: { ...prediction, actual: outcome.actual, error: outcome.error, within_tolerance: outcome.withinTolerance },
  });
}
</script>

<template>
  <section class="space-y-4">
    <header>
      <h2 class="text-lg font-semibold" data-testid="step-title">{{ def.step }}. {{ def.title }}</h2>
      <p class="text-sm text-zinc-500" data-testid="step-purpose">{{ def.purpose }}</p>
    </header>

    <div class="space-y-4"><slot /></div>

    <PredictionGate
      :question="asked.question"
      :answer-type="def.answerType"
      :tolerance="asked.tolerance"
      :choices="def.choices"
      :unit="asked.unit"
      :hint="def.hint"
      :committed="committed"
      :actual="truth"
      :unavailable="unavailable"
      @submit="onSubmit"
      @reveal="onReveal"
    />

    <label v-if="committed" class="block space-y-1">
      <span class="text-sm font-medium">What you take away from this step</span>
      <textarea
        :value="step.takeaway"
        rows="2"
        class="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
        placeholder="One line, in your own words."
        data-testid="step-takeaway"
        @input="emit('patch', { takeaway: ($event.target as HTMLTextAreaElement).value })"
      />
    </label>
  </section>
</template>
