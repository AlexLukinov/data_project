<script setup lang="ts">
/**
 * "What is actually in this range?" (spec §7): the grouped distribution as a collapsible
 * tree with raw, weighted and share counts at every level, an optional second range side by
 * side with a delta column, group click → the app highlights the combos, CSV and text export.
 * Each axis checkbox's label explains its axis on hover or when the checkbox has focus (ADR-056);
 * the label stays the tooltip's trigger, so a click on the word still ticks the box.
 */
import type { Axis, Card, DistributionGroup, GroupComparison, Thresholds, WeightedRange } from '@poker/core';
import { AXES, DEFAULT_THRESHOLDS, compareDistributions, distribute, toCsv, toText } from '@poker/core';
import { computed } from 'vue';

import { AXIS_WORDS } from '../vocabulary';
import DistributionNode from './DistributionNode.vue';
import TermLabel from './TermLabel.vue';

const props = withDefaults(
  defineProps<{
    range: WeightedRange;
    board: readonly Card[];
    groupBy: readonly Axis[];
    compareRange?: WeightedRange | null;
    equities?: Float32Array | null;
    compareEquities?: Float32Array | null;
    thresholds?: Partial<Thresholds>;
  }>(),
  { compareRange: null, equities: null, compareEquities: null, thresholds: () => ({}) },
);
const emit = defineEmits<{ groupClick: [group: DistributionGroup]; export: [csv: string]; 'update:groupBy': [axes: Axis[]] }>();

const PERCENT = 100;

function options(equities: Float32Array | null) {
  return { thresholds: props.thresholds, ...(equities === null ? {} : { equities }) };
}

/** The tree, or the reason there is none (an axis missing its input). */
const outcome = computed<{ rows: GroupComparison[]; error: string | null }>(() => {
  try {
    const main = distribute(props.range, props.board, props.groupBy, options(props.equities));
    const other = props.compareRange === null ? null : distribute(props.compareRange, props.board, props.groupBy, options(props.compareEquities));
    const rows = other === null ? compareDistributions(main, main).map(dropB) : compareDistributions(main, other);
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
});
const rows = computed(() => outcome.value.rows);
const error = computed(() => outcome.value.error);

/**
 * Core's reason, with the one thing the reader can always do about it.
 *
 * `distribute` refuses an axis whose input is missing, in its own words — "the strategic axis
 * needs per-combo equities" — which names a thing the reader never asked for and no way out of
 * it. The axes are checkboxes, so unticking is always available and always works; where the
 * equities would have come from is the page's business, not this panel's, and it does not
 * pretend to know.
 */
const errorWords = computed(() =>
  error.value === null ? '' : `This grouping cannot be drawn: ${error.value}. Untick that axis to read the rest of the tree.`,
);

function dropB(row: GroupComparison): GroupComparison {
  return { ...row, b: null, deltaShare: 0, deltaWeight: 0, children: row.children.map(dropB) };
}

const thresholdNote = computed(() => {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...props.thresholds };
  return `value ≥ ${Math.round(PERCENT * t.value)}% equity · bluff-catcher ≥ ${Math.round(PERCENT * t.bluffCatcher)}%${t.nut === undefined ? '' : ` · nut ≥ ${Math.round(PERCENT * t.nut)}%`}`;
});

function toggleAxis(axis: Axis): void {
  const next = props.groupBy.includes(axis) ? props.groupBy.filter((a) => a !== axis) : [...props.groupBy, axis];
  emit('update:groupBy', next);
}

function exportCsv(): void {
  emit('export', toCsv(distribute(props.range, props.board, props.groupBy, options(props.equities))));
}

async function copyText(): Promise<void> {
  const text = toText(distribute(props.range, props.board, props.groupBy, options(props.equities)), true);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    emit('export', text);
  }
}
</script>

<template>
  <div class="pk-dist">
    <div class="pk-toolbar">
      <span class="pk-axes">
        <TermLabel v-for="axis in AXES" :key="axis" :entry="AXIS_WORDS[axis]">
          <template #default="{ describedby }">
            <label class="pk-axis"><input type="checkbox" :checked="groupBy.includes(axis)" :aria-describedby="describedby" :data-axis="axis" @change="toggleAxis(axis)" /> <span class="pk-axis-word">{{ AXIS_WORDS[axis].term }}</span></label>
          </template>
        </TermLabel>
      </span>
      <!-- Disabled while there is no tree: both handlers call `distribute` again, and with an axis
           missing its input that throws — uncaught, out of a click, with the panel already saying
           why on screen. Reachable since F.12 bound these axes on the hand replayer, where the
           equity calculator only runs with a chart for both seats. -->
      <span class="pk-actions">
        <button type="button" class="pk-btn" :disabled="error !== null" @click="exportCsv">Export CSV</button>
        <button type="button" class="pk-btn" :disabled="error !== null" @click="copyText">Copy as text</button>
      </span>
    </div>
    <p v-if="groupBy.some((a) => a === 'strategic' || a === 'nut')" class="pk-muted">Thresholds: {{ thresholdNote }}</p>
    <p v-if="error" class="pk-error" role="alert">{{ errorWords }}</p>
    <div v-else class="pk-tree">
      <div class="pk-head">
        <span>group</span>
        <span class="pk-cells"><span class="pk-cell">{{ range.label ?? 'range' }}: combos · weighted · share</span><template v-if="compareRange"><span class="pk-cell">{{ compareRange.label ?? 'compare' }}</span><span class="pk-cell pk-delta">Δ share</span></template></span>
      </div>
      <DistributionNode v-for="row in rows" :key="row.key" :row="row" :compare="compareRange !== null" @group-click="emit('groupClick', $event)" />
      <p v-if="rows.length === 0" class="pk-muted">Nothing to group: the range is empty on this board.</p>
    </div>
  </div>
</template>

<style scoped>
.pk-dist {
  display: grid;
  gap: 0.5rem;
  color: var(--pk-fg, #18181b);
}
.pk-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.pk-axes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.pk-actions {
  display: flex;
  gap: 0.5rem;
}
/* The word is explained on hover but is still the checkbox's label, so it keeps a pointer, not `help`. */
.pk-axis {
  cursor: pointer;
}
.pk-axis-word {
  border-bottom: 1px dotted currentColor;
}
.pk-btn {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-surface, #f4f4f5);
  color: inherit;
  cursor: pointer;
}
.pk-tree {
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  overflow-x: auto;
}
.pk-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--pk-border, #d4d4d8);
}
.pk-cells {
  display: grid;
  grid-auto-flow: column;
  gap: 1rem;
  white-space: nowrap;
}
.pk-cell {
  min-width: 9rem;
  text-align: right;
}
.pk-delta {
  min-width: 5rem;
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pk-heart, #dc2626);
}
</style>
