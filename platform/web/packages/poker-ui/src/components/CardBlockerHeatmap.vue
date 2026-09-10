<script setup lang="ts">
/**
 * "What does holding the A♣ actually do here?" (spec §6.2): a 4×13 grid of the 52 cards,
 * each shaded by how much of villain's range it removes; hovering a card lists the removal
 * per made-hand class.
 */
import type { Card, CardRemoval, WeightedRange } from '@poker/core';
import { MADE_HAND_CLASSES, RANK_CHARS, SUIT_COUNT, cardRemovalHeatmap, makeCard } from '@poker/core';
import { computed, ref } from 'vue';

import { SUIT_NAMES, cardLabel, percent } from '../format';

const props = defineProps<{ villainRange: WeightedRange; board: readonly Card[] }>();
const emit = defineEmits<{ cardHover: [card: Card | null] }>();

const heat = computed(() => cardRemovalHeatmap(props.villainRange, props.board));
const max = computed(() => Math.max(...heat.value.map((h) => h.fraction), 0.0001));
const hovered = ref<Card | null>(null);

const rows = computed(() =>
  Array.from({ length: SUIT_COUNT }, (_, suit) => ({
    suit,
    name: SUIT_NAMES[suit]!,
    cells: Array.from({ length: RANK_CHARS.length }, (_, i) => heat.value[makeCard(12 - i, suit)]!),
  })),
);

const detail = computed(() => {
  if (hovered.value === null) return null;
  const h = heat.value[hovered.value]!;
  const classes = MADE_HAND_CLASSES.filter((cls) => h.byClass[cls] !== undefined).map((cls) => ({ cls, ...h.byClass[cls]! }));
  return { card: hovered.value, removal: h, classes };
});

function hover(cell: CardRemoval | null): void {
  hovered.value = cell?.card ?? null;
  emit('cardHover', hovered.value);
}

function label(cell: CardRemoval): string {
  return cell.onBoard ? `${cardLabel(cell.card)} is on the board` : `${cardLabel(cell.card)} removes ${percent(cell.fraction)} of villain's range`;
}
</script>

<template>
  <div class="pk-heatmap" @pointerleave="hover(null)">
    <div v-for="row in rows" :key="row.suit" class="pk-row">
      <button
        v-for="cell in row.cells"
        :key="cell.card"
        type="button"
        class="pk-card"
        :class="[`pk-${row.name}`, { 'pk-on-board': cell.onBoard }]"
        :style="{ '--heat': cell.onBoard ? 0 : cell.fraction / max }"
        :title="label(cell)"
        :aria-label="label(cell)"
        @pointerenter="hover(cell)"
        @focus="hover(cell)"
      >
        {{ cardLabel(cell.card) }}
      </button>
    </div>
    <p class="pk-detail" aria-live="polite">
      <template v-if="detail">
        <strong>{{ cardLabel(detail.card) }}</strong>
        <template v-if="detail.removal.onBoard"> is on the board.</template>
        <template v-else>
          removes {{ percent(detail.removal.fraction) }} of the range<span v-if="detail.classes.length">:
            <span v-for="c in detail.classes" :key="c.cls" class="pk-class">{{ c.cls.replace(/_/g, ' ') }} {{ percent(c.fraction, 0) }}</span></span>
        </template>
      </template>
      <template v-else>Hover a card to see what holding it removes.</template>
    </p>
  </div>
</template>

<style scoped>
.pk-heatmap {
  display: grid;
  gap: 2px;
  color: var(--pk-fg, #18181b);
}
.pk-row {
  display: grid;
  grid-template-columns: repeat(13, minmax(0, 1fr));
  gap: 2px;
}
.pk-card {
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.35rem 0;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 3px;
  background: color-mix(in srgb, hsl(var(--pk-heat, 220 80% 50%)) calc(var(--heat) * 85%), var(--pk-surface, #f4f4f5));
  cursor: default;
}
.pk-on-board {
  opacity: 0.35;
  text-decoration: line-through;
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
.pk-detail {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  min-height: 1.4em;
  color: var(--pk-muted, #71717a);
}
.pk-class {
  display: inline-block;
  margin-right: 0.6rem;
}
</style>
