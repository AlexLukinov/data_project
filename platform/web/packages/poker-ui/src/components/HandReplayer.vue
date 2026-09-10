<script setup lang="ts">
/**
 * Step through a hand on a visual table (spec §9.2), with the action log beside it.
 *
 * The component owns nothing but the play timer: the step is a `v-model`, and every change
 * reports the situation the hand is now in (`nodeChange`), which is how the analysis panels
 * around it rebind to the current node (spec §9.3) without this component knowing they exist.
 */
import type { HandState, NodeKey, ReplayHand, Street } from '@poker/core';
import { firstIndexOfStreet, nodeKeyAt, replayStates, streetsPlayed } from '@poker/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { actionText, tableSeats } from '../table';
import HandActionLog from './HandActionLog.vue';
import PokerTable from './PokerTable.vue';

const props = defineProps<{ hand: ReplayHand }>();
const emit = defineEmits<{ nodeChange: [node: NodeKey | null, state: HandState] }>();

/** The step being shown: 0 is the deal, `actions.length` is the end of the hand. */
const step = defineModel<number>({ default: 0 });
/** Milliseconds per step while playing. */
const speed = defineModel<number>('speed', { default: 900 });

const SPEEDS = [1800, 900, 400] as const;
const STREET_KEYS = ['1', '2', '3', '4'] as const;
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT'];

const states = computed(() => replayStates(props.hand));
const last = computed(() => states.value.length - 1);
const at = computed(() => states.value[Math.min(Math.max(step.value, 0), last.value)]!);
const streets = computed(() => streetsPlayed(props.hand));
const seats = computed(() => tableSeats(props.hand, at.value));
const buttonSeat = computed(() => props.hand.seats.find((s) => s.position === 'BTN')?.seat ?? null);
const lastAction = computed(() => (at.value.last === null ? '' : actionText(at.value.last, (v) => v.toFixed(2))));

const playing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  playing.value = false;
}

/** Seek, always by hand: any manual move stops the playback. */
function seek(to: number): void {
  stop();
  step.value = Math.min(Math.max(to, 0), last.value);
}

function play(): void {
  if (playing.value) {
    stop();
    return;
  }
  if (step.value >= last.value) step.value = 0;
  playing.value = true;
  timer = setInterval(() => (step.value >= last.value ? stop() : (step.value += 1)), speed.value);
}

function toStreet(street: Street): void {
  seek(firstIndexOfStreet(props.hand, street));
}

function onSeek(event: Event): void {
  seek(Number((event.target as HTMLInputElement).value));
}

function fromKeyboard(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target !== null && (target.isContentEditable || TYPING.includes(target.tagName))) return;
  const streetKey = STREET_KEYS.indexOf(event.key as (typeof STREET_KEYS)[number]);
  const street = streetKey === -1 ? undefined : streets.value[streetKey];
  if (event.key === 'ArrowRight') seek(step.value + 1);
  else if (event.key === 'ArrowLeft') seek(step.value - 1);
  else if (event.key === ' ') play();
  else if (street !== undefined) toStreet(street);
  else return;
  event.preventDefault();
}

watch(at, () => emit('nodeChange', nodeKeyAt(props.hand, at.value.index), at.value), { immediate: true });
watch(
  () => props.hand,
  () => seek(0),
);
watch(speed, () => {
  if (playing.value) {
    stop();
    play();
  }
});
onMounted(() => window.addEventListener('keydown', fromKeyboard));
onBeforeUnmount(() => {
  stop();
  window.removeEventListener('keydown', fromKeyboard);
});
</script>

<template>
  <div class="pk-replayer">
    <div class="pk-stage">
      <PokerTable :seats="seats" :board="at.board" :pot="at.pot" :active-seat="at.actor" :last-action="lastAction" :last-seat="at.last?.seat ?? null" :big-blind="hand.bigBlind" :button-seat="buttonSeat" :hand-over="step >= last" />
      <div class="pk-controls">
        <button type="button" data-testid="replay-back" :disabled="step === 0" @click="seek(step - 1)">← back</button>
        <button type="button" data-testid="replay-play" @click="play">{{ playing ? '❚❚ pause' : '▶ play' }}</button>
        <button type="button" data-testid="replay-next" :disabled="step === last" @click="seek(step + 1)">next →</button>
        <span class="pk-streets">
          <button v-for="(street, i) in streets" :key="street" type="button" :data-testid="`replay-street-${street}`" :class="{ 'pk-on': at.street === street }" @click="toStreet(street)">{{ street }} <kbd>{{ i + 1 }}</kbd></button>
        </span>
        <label class="pk-speed">speed
          <select v-model.number="speed" data-testid="replay-speed">
            <option v-for="ms in SPEEDS" :key="ms" :value="ms">{{ (1000 / ms).toFixed(1) }}×</option>
          </select>
        </label>
        <span class="pk-step" data-testid="replay-step">step {{ step }} / {{ last }}</span>
      </div>
      <input type="range" class="pk-seek" min="0" :max="last" :value="step" aria-label="step" data-testid="replay-seek" @input="onSeek" />
    </div>
    <HandActionLog :hand="hand" :states="states" :current="step" @seek="seek" />
  </div>
</template>

<style scoped>
.pk-replayer {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}
@media (max-width: 60rem) {
  .pk-replayer {
    grid-template-columns: minmax(0, 1fr);
  }
}
.pk-stage {
  display: grid;
  gap: 0.5rem;
  align-content: start;
}
.pk-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
button {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.3rem;
  background: var(--pk-bg, #fff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.pk-streets {
  display: flex;
  gap: 0.2rem;
  margin-left: auto;
}
.pk-on {
  border-color: var(--pk-accent, #2563eb);
  font-weight: 600;
}
kbd {
  font-size: 0.7rem;
  color: var(--pk-muted, #71717a);
}
.pk-speed {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
  color: var(--pk-muted, #71717a);
}
select {
  font: inherit;
  background: var(--pk-bg, #fff);
  color: inherit;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.3rem;
}
.pk-step {
  color: var(--pk-muted, #71717a);
  font-variant-numeric: tabular-nums;
}
.pk-seek {
  width: 100%;
}
</style>
