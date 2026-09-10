<script setup lang="ts">
/**
 * The nine steps as a rail (spec §15, §12): where you are, what is done, and one click to any
 * of them. Nothing is locked — the analyzer teaches an order, it does not enforce one, and a
 * step you skipped simply stays unmarked.
 *
 * Keyboard-first per §13: left/right walk the rail, and the digits 1–9 jump straight to a step.
 */
import { computed } from 'vue';

import type { StepLabel } from '../stepper';

const props = defineProps<{
  steps: readonly StepLabel[];
  current: number;
  /** The step numbers whose prediction has been committed. */
  completed: readonly number[];
}>();

const emit = defineEmits<{ navigate: [step: number] }>();

const done = computed(() => new Set(props.completed));
const numbers = computed(() => props.steps.map((s) => s.step));

function go(step: number): void {
  if (numbers.value.includes(step) && step !== props.current) emit('navigate', step);
}

function step(by: number): void {
  const at = numbers.value.indexOf(props.current);
  const next = numbers.value[Math.min(Math.max(at + by, 0), numbers.value.length - 1)];
  if (next !== undefined) go(next);
}

function onKey(event: KeyboardEvent): void {
  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit > 0) go(digit);
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key === 'ArrowRight') step(1);
  else return;
  event.preventDefault();
}
</script>

<template>
  <nav class="pk-stepper" aria-label="Analysis steps" data-testid="stepper" @keydown="onKey">
    <ol class="pk-rail">
      <li v-for="item in steps" :key="item.step">
        <button
          type="button"
          class="pk-step"
          :class="{ 'pk-current': item.step === current, 'pk-done': done.has(item.step) }"
          :aria-current="item.step === current ? 'step' : undefined"
          :data-testid="`stepper-${item.step}`"
          @click="go(item.step)"
        >
          <span class="pk-num">{{ done.has(item.step) ? '✓' : item.step }}</span>
          <span class="pk-title">{{ item.title }}</span>
        </button>
      </li>
    </ol>
    <p class="pk-progress" data-testid="stepper-progress">{{ completed.length }} of {{ steps.length }} committed</p>
  </nav>
</template>

<style scoped>
.pk-stepper {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.pk-rail {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pk-step {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  background: none;
  color: var(--pk-muted, #71717a);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pk-step:hover {
  background: var(--pk-surface, #f4f4f5);
}
.pk-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.4rem;
  height: 1.4rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 50%;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.pk-done .pk-num {
  border-color: var(--pk-good, #15803d);
  color: var(--pk-good, #15803d);
}
.pk-current {
  border-color: var(--pk-border, #d4d4d8);
  background: var(--pk-surface, #f4f4f5);
  color: var(--pk-fg, #18181b);
  font-weight: 500;
}
.pk-title {
  font-size: 0.85rem;
}
.pk-progress {
  margin: 0;
  padding-left: 0.5rem;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
}
</style>
