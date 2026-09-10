<script setup lang="ts">
/**
 * Every action of the hand with the pot and the acting seat's stack after it (spec §9.2).
 * Clicking a line seeks to it, so the log is the hand's timeline as well as its transcript.
 */
import type { HandState, ReplayHand } from '@poker/core';
import { computed } from 'vue';

import { actionText } from '../table';

const props = defineProps<{
  hand: ReplayHand;
  /** One per step, as `replayStates` returns them. */
  states: readonly HandState[];
  /** The step the replayer is showing: `states[current]`. */
  current: number;
}>();
const emit = defineEmits<{ seek: [index: number] }>();

interface Line {
  readonly step: number;
  readonly street: string;
  readonly who: string;
  readonly what: string;
  readonly pot: number;
  readonly stack: number;
  readonly newStreet: boolean;
}

function money(value: number): string {
  return value.toFixed(2);
}

const names = computed(() => new Map(props.hand.seats.map((s) => [s.seat, `${s.position} ${s.name}`])));

const lines = computed<Line[]>(() =>
  props.hand.actions.map((action, i) => {
    const after = props.states[i + 1];
    return {
      step: i + 1,
      street: action.street,
      who: names.value.get(action.seat) ?? `seat ${action.seat}`,
      what: actionText(action, money),
      pot: after?.pot ?? 0,
      stack: after?.seats.find((s) => s.seat === action.seat)?.stack ?? 0,
      newStreet: i === 0 || props.hand.actions[i - 1]?.street !== action.street,
    };
  }),
);
</script>

<template>
  <ol class="pk-log" data-testid="hand-log">
    <li v-for="line in lines" :key="line.step" :class="{ 'pk-now': line.step === current, 'pk-street': line.newStreet }">
      <button type="button" :data-testid="`log-step-${line.step}`" @click="emit('seek', line.step)">
        <span class="pk-who">{{ line.who }}</span>
        <span class="pk-what">{{ line.what }}</span>
        <span class="pk-after">pot {{ money(line.pot) }} · left {{ money(line.stack) }}</span>
      </button>
    </li>
  </ol>
</template>

<style scoped>
.pk-log {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 22rem;
  overflow-y: auto;
  font-size: 0.8rem;
  color: var(--pk-fg, #18181b);
}
li button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) auto;
  gap: 0.5rem;
  width: 100%;
  padding: 0.2rem 0.3rem;
  border: 0;
  border-left: 3px solid transparent;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
li button:hover {
  background: var(--pk-surface, #f4f4f5);
}
.pk-street button {
  border-top: 1px solid var(--pk-border, #d4d4d8);
}
.pk-now button {
  border-left-color: var(--pk-accent, #2563eb);
  background: var(--pk-surface, #f4f4f5);
  font-weight: 600;
}
.pk-who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-after {
  color: var(--pk-muted, #71717a);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
