<script setup lang="ts">
/**
 * Commit an answer before seeing the answer (spec §15, §12).
 *
 * Every step of the analyzer runs through this gate: the question is asked, the user commits,
 * and only then does the parent fetch or compute the truth and hand it back through `actual`.
 * The component never receives the answer in advance — that is deliberate, and it is why
 * `actual` is `null` until `submit` has fired.
 *
 * A committed answer restores from the saved analysis, so reopening shows the reveal again
 * rather than asking a question the user has already answered.
 */
import { computed, ref, watch } from 'vue';

import type { AnswerType, PredictionOutcome } from '../prediction';
import { explainPrediction, isNumeric, scorePrediction } from '../prediction';

const props = withDefaults(
  defineProps<{
    question: string;
    answerType?: AnswerType;
    /** In the answer's own unit: percentage points, combos, a ratio. */
    tolerance?: number;
    /** For `choice`: the options to pick between. */
    choices?: readonly string[];
    /** Shown after the number ("combos", "bb"); percentages label themselves. */
    unit?: string;
    /** The truth — supplied by the parent only once the answer is committed. */
    actual?: string | null;
    /** A previously committed answer, restoring the gate from a saved analysis. */
    committed?: string | null;
    /** One line saying what to think about; never a hint at the answer. */
    hint?: string;
    /** Why there is no truth to compare against — shown instead of waiting for one for ever. */
    unavailable?: string;
  }>(),
  { answerType: 'text', tolerance: 0, choices: () => [], unit: '', actual: null, committed: null, hint: '', unavailable: '' },
);

const emit = defineEmits<{ submit: [answer: string]; reveal: [outcome: PredictionOutcome] }>();

const draft = ref('');
const locked = computed(() => props.committed !== null && props.committed !== '');
const answered = computed(() => props.committed ?? '');
const numeric = computed(() => isNumeric(props.answerType));
const unitLabel = computed(() => (props.answerType === 'percent' ? '%' : props.unit));

const outcome = computed<PredictionOutcome | null>(() =>
  locked.value && props.actual !== null && props.actual !== ''
    ? scorePrediction(answered.value, props.actual, props.answerType, props.tolerance)
    : null,
);
const sentence = computed(() => (outcome.value === null ? '' : explainPrediction(outcome.value, props.answerType, props.unit)));
/** A number input hands back a number; the answer is stored and compared as text. */
const typed = computed(() => String(draft.value).trim());

// The reveal is an event so the parent can record it on the step; it fires once per truth.
watch(outcome, (next) => {
  if (next !== null) emit('reveal', next);
});

function commit(answer: string): void {
  if (answer === '' || locked.value) return;
  emit('submit', answer);
  draft.value = '';
}
</script>

<template>
  <section class="pk-gate" :class="{ 'pk-open': !locked }" data-testid="prediction-gate">
    <p class="pk-question">
      <span class="pk-tag">your call</span>
      <span data-testid="gate-question">{{ question }}</span>
    </p>
    <p v-if="hint && !locked" class="pk-hint">{{ hint }}</p>

    <div v-if="!locked" class="pk-answer">
      <template v-if="answerType === 'choice'">
        <button v-for="choice in choices" :key="choice" type="button" class="pk-choice" :data-testid="`gate-choice-${choice}`" @click="commit(choice)">
          {{ choice }}
        </button>
      </template>
      <template v-else>
        <label class="pk-field">
          <input
            v-model="draft"
            :type="numeric ? 'number' : 'text'"
            step="any"
            class="pk-input"
            data-testid="gate-input"
            :placeholder="numeric ? 'your estimate' : 'your answer'"
            @keyup.enter="commit(typed)"
          />
          <span v-if="unitLabel" class="pk-unit">{{ unitLabel }}</span>
        </label>
        <button type="button" class="pk-commit" data-testid="gate-commit" :disabled="typed === ''" @click="commit(typed)">Commit</button>
      </template>
    </div>

    <div v-else class="pk-revealed">
      <p class="pk-said" data-testid="gate-answer">You committed <strong>{{ answered }}{{ unitLabel }}</strong></p>
      <p v-if="outcome" class="pk-verdict" :class="outcome.withinTolerance ? 'pk-right' : 'pk-off'" data-testid="gate-verdict">{{ sentence }}</p>
      <p v-else-if="unavailable" class="pk-waiting" data-testid="gate-unavailable">{{ unavailable }}</p>
      <p v-else class="pk-waiting" data-testid="gate-waiting">Working out what actually happens here…</p>
    </div>
  </section>
</template>

<style scoped>
.pk-gate {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--pk-border, #e4e4e7);
  border-radius: 0.5rem;
  background: var(--pk-surface, #f4f4f5);
}
.pk-open {
  border-color: var(--pk-highlight, #f59e0b);
}
.pk-question {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  font-weight: 500;
}
.pk-tag {
  padding: 0.05rem 0.4rem;
  border-radius: 0.6rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--pk-highlight, #f59e0b);
  color: #18181b;
}
.pk-hint,
.pk-waiting {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-answer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.pk-field {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
}
.pk-input {
  width: 9rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--pk-border, #e4e4e7);
  border-radius: 0.35rem;
  background: var(--pk-bg, #ffffff);
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.pk-unit {
  color: var(--pk-muted, #71717a);
}
.pk-choice,
.pk-commit {
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--pk-border, #e4e4e7);
  border-radius: 0.35rem;
  background: var(--pk-bg, #ffffff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.pk-choice:hover:not(:disabled),
.pk-commit:hover:not(:disabled) {
  border-color: var(--pk-highlight, #f59e0b);
}
.pk-commit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.pk-revealed {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.pk-said {
  margin: 0;
  font-size: 0.85rem;
}
.pk-verdict {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 500;
}
.pk-right {
  color: var(--pk-good, #16a34a);
}
.pk-off {
  color: var(--pk-bad, #dc2626);
}
</style>
