<script setup lang="ts">
/**
 * The per-combo blocker table (spec §6.2): hero's combos against villain's calling and folding
 * ranges, sortable by any score, with the bluff-count arithmetic for a bet size when one is
 * given. Clicking a row selects the combo for the card and class views.
 */
import type { BlockerRow, Card, ComboIndex, WeightedRange } from '@poker/core';
import { blockerTable, classRemovalBreakdown, comboToString, rankBluffCandidates, union } from '@poker/core';
import { computed, ref } from 'vue';

import { num, percent } from '../format';
import type { GlossaryKey } from '../glossary';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    heroRange: WeightedRange;
    villainCall: WeightedRange;
    villainFold: WeightedRange;
    /** Hero's hand: its row is marked and, with a board, the classes it kills are listed. */
    selectedCombo?: ComboIndex | null;
    /** The board (3–5 cards) for the class breakdown of the selected combo. */
    board?: readonly Card[];
    deadCards?: readonly Card[];
    pot?: number | null;
    bet?: number | null;
    /** Which hero combos are value bets; the rest are bluff candidates. */
    isValue?: (combo: ComboIndex) => boolean;
    limit?: number;
  }>(),
  { selectedCombo: null, board: () => [], deadCards: () => [], pot: null, bet: null, isValue: () => false, limit: 60 },
);

const FLOP = 3;

/** "Villain's flush draws: 5 → 2" for the selected combo against villain's whole range. */
const breakdown = computed(() => {
  if (props.selectedCombo === null || props.board.length < FLOP) return null;
  const rows = classRemovalBreakdown(union(props.villainCall, props.villainFold), props.board, props.selectedCombo);
  return rows.filter((r) => r.before.combos !== r.after.combos || r.before.weight !== r.after.weight);
});
const selectedRow = computed(() => (props.selectedCombo === null ? null : (table.value.byCombo.get(props.selectedCombo) ?? null)));
const emit = defineEmits<{ comboSelect: [combo: ComboIndex] }>();

type Column = 'combo' | 'weight' | 'removalCall' | 'removalFold' | 'bluffScore' | 'valueScore';
const COLUMNS: { key: Column; label: string; title: string; term?: GlossaryKey }[] = [
  { key: 'combo', label: 'Combo', title: "Hero's combo" },
  { key: 'weight', label: 'Weight', title: 'Weight in the hero range' },
  { key: 'removalCall', label: 'Removes calls', title: "Share of villain's calling range this combo makes impossible" },
  { key: 'removalFold', label: 'Removes folds', title: "Share of villain's folding range this combo makes impossible" },
  { key: 'bluffScore', label: 'Bluff score', title: 'removes calls − removes folds: higher is a better bluff', term: 'blockerScore' },
  { key: 'valueScore', label: 'Value score', title: 'removes folds − removes calls: higher is a better thin value bet', term: 'valueScore' },
];

const sortBy = ref<Column>('bluffScore');
const descending = ref(true);

const table = computed(() => blockerTable(props.heroRange, props.villainCall, props.villainFold, props.deadCards));
const ranking = computed(() => (props.pot !== null && props.bet !== null && props.pot > 0 ? rankBluffCandidates(table.value, props.isValue, props.pot, props.bet) : null));

const rows = computed(() => {
  const sorted = [...table.value.rows].sort((a, b) => {
    const d = a[sortBy.value] - b[sortBy.value];
    return (descending.value ? -d : d) || a.combo - b.combo;
  });
  return sorted.slice(0, props.limit);
});

function sort(column: Column): void {
  if (sortBy.value === column) descending.value = !descending.value;
  else {
    sortBy.value = column;
    descending.value = column !== 'combo';
  }
}

function cell(row: BlockerRow, column: Column): string {
  if (column === 'combo') return comboToString(row.combo);
  if (column === 'weight') return num(row.weight);
  if (column === 'bluffScore' || column === 'valueScore') return `${row[column] >= 0 ? '+' : ''}${(100 * row[column]).toFixed(1)}`;
  return percent(row[column]);
}
</script>

<template>
  <div class="pk-blockers">
    <p class="pk-muted">
      Villain calls with {{ num(table.callTotal) }} weighted combos and folds {{ num(table.foldTotal) }}. A good bluff blocks calls and unblocks folds; a good thin value bet does the opposite.
    </p>
    <div v-if="selectedCombo !== null" class="pk-hand" data-testid="hand-removal">
      <p class="pk-hand-title">
        <strong>{{ comboToString(selectedCombo) }}</strong>
        <template v-if="selectedRow"> kills {{ num(selectedRow.blockedCall) }} of villain's {{ num(table.callTotal) }} calling combos and {{ num(selectedRow.blockedFold) }} of {{ num(table.foldTotal) }} folds (bluff score {{ (100 * selectedRow.bluffScore).toFixed(1) }}).</template>
        <template v-else> is not in hero's range here.</template>
      </p>
      <ul v-if="breakdown && breakdown.length" class="pk-classes">
        <li v-for="row in breakdown" :key="`${row.kind}:${row.cls}`">villain's {{ row.cls.replace(/_/g, ' ') }}: {{ row.before.combos }} → {{ row.after.combos }}</li>
      </ul>
      <p v-else-if="breakdown" class="pk-muted">It removes nothing from villain's classes on this board.</p>
      <p v-else class="pk-muted">Set a board to see which of villain's classes it kills.</p>
    </div>
    <p v-if="ranking" class="pk-ranking" data-testid="bluff-ranking">
      Bet {{ num(ranking.bet) }} into {{ num(ranking.pot) }}: balance calls for {{ num(ranking.bluffsPerValue) }} bluffs per value combo — {{ num(ranking.bluffsNeeded) }} bluffs for {{ num(ranking.valueWeight) }} value combos; hero has {{ num(ranking.bluffsAvailable) }} candidates<span v-if="ranking.shortfall > 0">, {{ num(ranking.shortfall) }} short</span>.
    </p>
    <div class="pk-scroll">
      <table class="pk-table">
        <thead>
          <tr>
            <th v-for="c in COLUMNS" :key="c.key" :title="c.title" :aria-sort="sortBy === c.key ? (descending ? 'descending' : 'ascending') : 'none'">
              <button type="button" class="pk-sort" @click="sort(c.key)">{{ c.label }}<span v-if="sortBy === c.key">{{ descending ? ' ▼' : ' ▲' }}</span></button>
              <MetricLabel v-if="c.term" :term="c.term" label="?" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.combo" :class="{ 'pk-selected': row.combo === selectedCombo, 'pk-value': isValue(row.combo) }" @click="emit('comboSelect', row.combo)">
            <td v-for="c in COLUMNS" :key="c.key" :class="{ 'pk-num': c.key !== 'combo' }">{{ cell(row, c.key) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="table.rows.length > limit" class="pk-muted">Showing {{ limit }} of {{ table.rows.length }} combos.</p>
  </div>
</template>

<style scoped>
.pk-blockers {
  display: grid;
  gap: 0.5rem;
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}
.pk-muted,
.pk-ranking,
.pk-hand-title {
  margin: 0;
}
.pk-hand {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-left: 3px solid var(--pk-highlight, #f59e0b);
  border-radius: 4px;
}
.pk-classes {
  margin: 0.25rem 0 0;
  padding-left: 1.2rem;
}
.pk-muted {
  color: var(--pk-muted, #71717a);
  font-size: 0.8rem;
}
.pk-scroll {
  overflow-x: auto;
}
.pk-table {
  border-collapse: collapse;
  width: 100%;
  font-variant-numeric: tabular-nums;
}
.pk-table th,
.pk-table td {
  padding: 0.2rem 0.5rem;
  border-bottom: 1px solid var(--pk-border, #d4d4d8);
  text-align: left;
  white-space: nowrap;
}
.pk-num {
  text-align: right;
}
.pk-sort {
  font: inherit;
  font-weight: 600;
  border: 0;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}
.pk-table tbody tr {
  cursor: pointer;
}
.pk-table tbody tr:hover {
  background: var(--pk-surface, #f4f4f5);
}
.pk-selected {
  outline: 2px solid var(--pk-accent, #2563eb);
}
.pk-value td:first-child::after {
  content: ' ★';
  color: var(--pk-highlight, #f59e0b);
}
</style>
