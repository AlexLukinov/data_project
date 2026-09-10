<script setup lang="ts">
/** Board and dead cards (spec §12): pick cards, see the street, remove with a click. */
import type { Card } from '@poker/core';
import { computed, ref } from 'vue';

import { cardLabel, suitName } from '../format';
import CardPicker from './CardPicker.vue';

const props = defineProps<{ board: readonly Card[]; deadCards: readonly Card[] }>();
const emit = defineEmits<{ 'update:board': [board: Card[]]; 'update:deadCards': [dead: Card[]] }>();

const BOARD_MAX = 5;
const STREETS = ['Preflop', '', '', 'Flop', 'Turn', 'River'];

const target = ref<'board' | 'dead'>('board');
const street = computed(() => STREETS[props.board.length] ?? '');
const chosen = computed(() => (target.value === 'board' ? props.board : props.deadCards));
const others = computed(() => (target.value === 'board' ? props.deadCards : props.board));

function toggle(card: Card): void {
  const list = [...chosen.value];
  const at = list.indexOf(card);
  if (at >= 0) list.splice(at, 1);
  else if (target.value === 'board' && list.length >= BOARD_MAX) return;
  else list.push(card);
  if (target.value === 'board') emit('update:board', list);
  else emit('update:deadCards', list);
}

function removeBoard(card: Card): void {
  emit('update:board', props.board.filter((c) => c !== card));
}

function removeDead(card: Card): void {
  emit('update:deadCards', props.deadCards.filter((c) => c !== card));
}
</script>

<template>
  <div class="pk-board">
    <div class="pk-line">
      <strong>{{ street || `${board.length} cards` }}</strong>
      <span class="pk-chips" aria-label="board">
        <button v-for="card in board" :key="card" type="button" class="pk-chip" :class="`pk-${suitName(card)}`" :title="`remove ${cardLabel(card)}`" @click="removeBoard(card)">{{ cardLabel(card) }}</button>
        <span v-if="board.length === 0" class="pk-muted">no board</span>
      </span>
    </div>
    <div class="pk-line">
      <span>Dead:</span>
      <span class="pk-chips" aria-label="dead cards">
        <button v-for="card in deadCards" :key="card" type="button" class="pk-chip" :class="`pk-${suitName(card)}`" :title="`remove ${cardLabel(card)}`" @click="removeDead(card)">{{ cardLabel(card) }}</button>
        <span v-if="deadCards.length === 0" class="pk-muted">none</span>
      </span>
    </div>
    <div class="pk-line pk-modes">
      <label><input v-model="target" type="radio" value="board" /> pick board cards</label>
      <label><input v-model="target" type="radio" value="dead" /> pick dead cards</label>
    </div>
    <CardPicker :selected="chosen" :disabled="others" :label="target === 'board' ? 'board cards' : 'dead cards'" @toggle="toggle" />
  </div>
</template>

<style scoped>
.pk-board {
  display: grid;
  gap: 0.5rem;
  color: var(--pk-fg, #18181b);
  font-size: 0.875rem;
}
.pk-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.pk-chips {
  display: inline-flex;
  gap: 0.25rem;
}
.pk-chip {
  font: inherit;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #fff);
  cursor: pointer;
}
.pk-club {
  color: var(--pk-club, #16a34a);
}
.pk-diamond {
  color: var(--pk-diamond, #2563eb);
}
.pk-heart {
  color: var(--pk-heart, #dc2626);
}
.pk-spade {
  color: var(--pk-spade, #18181b);
}
.pk-muted {
  color: var(--pk-muted, #71717a);
}
.pk-modes {
  gap: 1rem;
}
</style>
