<script setup lang="ts">
/** Dead cards and what they remove from a range: counts before and after, per card (spec §12). */
import type { Card, WeightedRange } from '@poker/core';
import { COMBOS_WITH_CARD, removeCards, totalCombos, weightedCombos } from '@poker/core';
import { computed } from 'vue';

import { cardLabel, num, suitName } from '../format';
import CardPicker from './CardPicker.vue';

const props = defineProps<{ range: WeightedRange; deadCards: readonly Card[] }>();
const emit = defineEmits<{ 'update:deadCards': [dead: Card[]] }>();

const before = computed(() => ({ combos: totalCombos(props.range), weight: weightedCombos(props.range) }));
const after = computed(() => {
  const live = removeCards(props.range, props.deadCards);
  return { combos: totalCombos(live), weight: weightedCombos(live) };
});

const perCard = computed(() =>
  props.deadCards.map((card) => {
    let combos = 0;
    let weight = 0;
    for (const combo of COMBOS_WITH_CARD[card]!) {
      const w = props.range.weights[combo]!;
      if (w > 0) {
        combos++;
        weight += w;
      }
    }
    return { card, combos, weight };
  }),
);

function toggle(card: Card): void {
  const list = [...props.deadCards];
  const at = list.indexOf(card);
  if (at >= 0) list.splice(at, 1);
  else list.push(card);
  emit('update:deadCards', list);
}
</script>

<template>
  <div class="pk-removal">
    <p class="pk-summary">
      <strong>{{ before.combos }}</strong> combos ({{ num(before.weight) }} weighted) →
      <strong>{{ after.combos }}</strong> ({{ num(after.weight) }} weighted) after {{ deadCards.length }} dead card{{ deadCards.length === 1 ? '' : 's' }}
    </p>
    <ul v-if="perCard.length" class="pk-list">
      <li v-for="row in perCard" :key="row.card">
        <span :class="`pk-${suitName(row.card)}`">{{ cardLabel(row.card) }}</span> removes {{ row.combos }} combos ({{ num(row.weight) }} weighted)
      </li>
    </ul>
    <button v-if="deadCards.length" type="button" class="pk-btn" @click="emit('update:deadCards', [])">Clear dead cards</button>
    <CardPicker :selected="deadCards" label="dead cards" @toggle="toggle" />
  </div>
</template>

<style scoped>
.pk-removal {
  display: grid;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--pk-fg, #18181b);
}
.pk-summary,
.pk-list {
  margin: 0;
}
.pk-list {
  padding-left: 1.2rem;
}
.pk-btn {
  justify-self: start;
  font: inherit;
  font-size: 0.875rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-surface, #f4f4f5);
  color: inherit;
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
</style>
