<script setup lang="ts">
/**
 * One matrix cell opened up (spec §12): the 6 / 4 / 12 combos of a hand class with their own
 * weights, which combos the board blocks, and what each makes on the board.
 */
import type { Card, HandClass, WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, classifyHand, comboCards, comboToString, createRange, handClassName } from '@poker/core';
import { computed } from 'vue';

import NumberInput from './NumberInput.vue';

const props = withDefaults(defineProps<{ handClass: HandClass | null; range: WeightedRange; board?: readonly Card[] }>(), { board: () => [] });
const emit = defineEmits<{ 'update:range': [range: WeightedRange] }>();

const FLOP = 3;
/**
 * Weights are stored as Float32, which holds about seven significant digits: seven show 0.3
 * rather than 0.30000001192092896 and keep 0.0004 as 0.0004 — rounding to places would show it as
 * 0, and typing 0 would then change nothing.
 */
const WEIGHT_SIGNIFICANT_DIGITS = 7;
const WEIGHT_STEP = 0.05;

const rows = computed(() => {
  if (props.handClass === null) return [];
  const onBoard = new Set(props.board);
  return HAND_CLASS_COMBOS[props.handClass]!.map((combo) => {
    const [a, b] = comboCards(combo);
    const blocked = onBoard.has(a) || onBoard.has(b);
    const made = !blocked && props.board.length >= FLOP ? classifyHand([a, b], props.board) : null;
    return { combo, text: comboToString(combo), weight: Number(props.range.weights[combo]!.toPrecision(WEIGHT_SIGNIFICANT_DIGITS)), blocked, made };
  });
});

function setWeight(combo: number, weight: number): void {
  const next = createRange(props.range.weights, props.range.label);
  next.weights[combo] = weight;
  emit('update:range', next);
}

function setAll(value: number): void {
  if (props.handClass === null) return;
  const next = createRange(props.range.weights, props.range.label);
  for (const combo of HAND_CLASS_COMBOS[props.handClass]!) next.weights[combo] = value;
  emit('update:range', next);
}
</script>

<template>
  <div class="pk-drill">
    <p v-if="handClass === null" class="pk-muted">Click a cell of the matrix to open its combos.</p>
    <template v-else>
      <div class="pk-head">
        <strong>{{ handClassName(handClass) }}</strong>
        <span class="pk-muted">{{ rows.length }} combos</span>
        <button type="button" class="pk-btn" @click="setAll(1)">all 100%</button>
        <button type="button" class="pk-btn" @click="setAll(0)">none</button>
      </div>
      <table class="pk-table">
        <tbody>
          <tr v-for="row in rows" :key="row.combo" :class="{ 'pk-blocked': row.blocked }">
            <td class="pk-combo">{{ row.text }}</td>
            <td>
              <NumberInput :model-value="row.weight" lazy :min="0" :max="1" :step="WEIGHT_STEP" :aria-label="`weight of ${row.text}`" :disabled="row.blocked" @update:model-value="setWeight(row.combo, $event)" />
            </td>
            <td class="pk-muted">
              <template v-if="row.blocked">blocked by the board</template>
              <template v-else-if="row.made">{{ row.made.made.replace(/_/g, ' ') }}<span v-if="row.made.draws[0] !== 'no_draw'"> · {{ row.made.draws.map((d) => d.replace(/_/g, ' ')).join(', ') }}</span></template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.pk-drill {
  display: grid;
  gap: 0.4rem;
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}
.pk-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.pk-btn {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-surface, #f4f4f5);
  color: inherit;
  cursor: pointer;
}
.pk-table {
  border-collapse: collapse;
}
.pk-table td {
  padding: 0.15rem 0.5rem;
  border-bottom: 1px solid var(--pk-border, #d4d4d8);
}
.pk-combo {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
input[inputmode='decimal'] {
  width: 5rem;
  font: inherit;
  padding: 0.1rem 0.3rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 3px;
  background: var(--pk-bg, #fff);
  color: inherit;
}
.pk-blocked {
  opacity: 0.5;
}
.pk-muted {
  margin: 0;
  color: var(--pk-muted, #71717a);
}
</style>
