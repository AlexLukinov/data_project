<script setup lang="ts">
/**
 * The 4×13 card grid every card input uses: a board, dead cards, hero's hand. Each card is a
 * toggle button, so it is keyboard-operable as it stands.
 */
import type { Card } from '@poker/core';
import { RANK_CHARS, SUIT_COUNT, makeCard } from '@poker/core';
import { computed } from 'vue';

import { SUIT_NAMES, SUIT_SYMBOLS, cardLabel } from '../format';

const props = withDefaults(defineProps<{ selected: readonly Card[]; disabled?: readonly Card[]; label?: string }>(), { disabled: () => [], label: 'cards' });
const emit = defineEmits<{ toggle: [card: Card] }>();

const selectedSet = computed(() => new Set(props.selected));
const disabledSet = computed(() => new Set(props.disabled));

const rows = computed(() =>
  Array.from({ length: SUIT_COUNT }, (_, suit) => ({
    suit,
    symbol: SUIT_SYMBOLS[suit]!,
    name: SUIT_NAMES[suit]!,
    cards: Array.from({ length: RANK_CHARS.length }, (_, rank) => makeCard(12 - rank, suit)),
  })),
);
</script>

<template>
  <div class="pk-picker" role="group" :aria-label="label">
    <div v-for="row in rows" :key="row.suit" class="pk-suit-row">
      <button
        v-for="card in row.cards"
        :key="card"
        type="button"
        class="pk-card"
        :class="[`pk-${row.name}`, { 'pk-on': selectedSet.has(card) }]"
        :aria-pressed="selectedSet.has(card)"
        :disabled="disabledSet.has(card) && !selectedSet.has(card)"
        :aria-label="cardLabel(card)"
        @click="emit('toggle', card)"
      >
        {{ cardLabel(card) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pk-picker {
  display: grid;
  gap: 2px;
}
.pk-suit-row {
  display: grid;
  grid-template-columns: repeat(13, minmax(0, 1fr));
  gap: 2px;
}
.pk-card {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.3rem 0;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 3px;
  background: var(--pk-surface, #f4f4f5);
  cursor: pointer;
}
.pk-card:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.pk-card.pk-on {
  background: var(--pk-accent, #2563eb);
  color: #fff;
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
.pk-card.pk-on.pk-club,
.pk-card.pk-on.pk-diamond,
.pk-card.pk-on.pk-heart,
.pk-card.pk-on.pk-spade {
  color: #fff;
}
</style>
