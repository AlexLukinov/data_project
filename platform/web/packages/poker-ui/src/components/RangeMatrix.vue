<script setup lang="ts">
/**
 * The 13×13 hand matrix (spec §12): weighted cells render as a partial fill, drag paints with
 * the brush weight, shift-drag erases, an optional heatmap overlays a per-combo value, the
 * combos a board or dead card block are shaded, and highlighted combos get a ring. Fully
 * keyboard-operable: arrows move; Enter/Space selects the focused cell (`cellClick`, in both
 * modes) and, in edit mode, toggles it between the brush and empty.
 *
 * One drag is one edit: the stroke is painted into a local draft the cells render from, and a
 * single `update:range` carries the whole stroke when the pointer lifts — so an undo takes back
 * the stroke, not the last cell it crossed. A stroke that changed no weight emits nothing.
 * This is the one grid in the repo (plan D.3's HandMatrix).
 */
import type { Card, ComboIndex, HandClass, WeightedRange } from '@poker/core';
import { COMBOS_WITH_CARD, HAND_CLASS_COMBOS, RANK_COUNT, createRange, handClassName, isPairClass, isSuitedClass, toHandClassMatrix } from '@poker/core';
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';

const props = withDefaults(
  defineProps<{
    range: WeightedRange;
    mode?: 'edit' | 'view';
    /** Weight painted by a click or drag, 0..1. */
    brush?: number;
    /** Per-combo values in 0..1 (equities, blocker scores…) shown as a colour overlay. */
    heatmap?: Float32Array | null;
    heatmapLabel?: string;
    /** The heatmap holds −1..1 differences: positive and negative get their own hue, zero no overlay. */
    heatmapSigned?: boolean;
    /** Combos to ring (a distribution group, a drill-down selection). */
    highlightCombos?: ReadonlySet<ComboIndex> | readonly ComboIndex[] | null;
    /** Board and dead cards: the combos they block are shaded. */
    blockedCards?: readonly Card[];
    selectedClass?: HandClass | null;
  }>(),
  { mode: 'edit', brush: 1, heatmap: null, heatmapLabel: '', heatmapSigned: false, highlightCombos: null, blockedCards: () => [], selectedClass: null },
);

/** A signed difference below this is "no change" and gets no overlay. */
const SIGNED_ZERO = 0.005;

const emit = defineEmits<{
  'update:range': [range: WeightedRange];
  cellClick: [cls: HandClass];
  cellHover: [cls: HandClass | null];
}>();

interface Cell {
  cls: HandClass;
  name: string;
  fill: number;
  count: number;
  possible: number;
  blocked: number;
  heat: number | null;
  highlight: number;
  kind: 'pair' | 'suited' | 'offsuit';
}

/** The stroke being painted, as the range will be once the pointer lifts; null between strokes. */
const draft = shallowRef<WeightedRange | null>(null);
/** What the cells show: the stroke while one is being painted, the range otherwise. */
const shown = computed(() => draft.value ?? props.range);

const blocked = computed(() => {
  const set = new Set<ComboIndex>();
  for (const card of props.blockedCards) for (const combo of COMBOS_WITH_CARD[card]!) set.add(combo);
  return set;
});

const highlighted = computed<ReadonlySet<ComboIndex> | null>(() => {
  if (props.highlightCombos === null) return null;
  return props.highlightCombos instanceof Set ? props.highlightCombos : new Set(props.highlightCombos);
});

function heatOf(cls: HandClass): number | null {
  if (props.heatmap === null) return null;
  let sum = 0;
  let n = 0;
  for (const combo of HAND_CLASS_COMBOS[cls]!) {
    const v = props.heatmap[combo]!;
    if (shown.value.weights[combo]! > 0 && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  if (n === 0) return null;
  const mean = sum / n;
  return props.heatmapSigned && Math.abs(mean) < SIGNED_ZERO ? null : mean;
}

const cells = computed<Cell[]>(() =>
  toHandClassMatrix(shown.value).map((cell) => {
    const combos = HAND_CLASS_COMBOS[cell.cls]!;
    let blockedCount = 0;
    let highlightCount = 0;
    for (const combo of combos) {
      if (blocked.value.has(combo)) blockedCount++;
      if (highlighted.value?.has(combo)) highlightCount++;
    }
    return {
      cls: cell.cls,
      name: handClassName(cell.cls),
      fill: Math.min(1, cell.averageWeight),
      count: cell.comboCount,
      possible: cell.possibleCombos,
      blocked: blockedCount / cell.possibleCombos,
      heat: heatOf(cell.cls),
      highlight: highlightCount / cell.possibleCombos,
      kind: isPairClass(cell.cls) ? 'pair' : isSuitedClass(cell.cls) ? 'suited' : 'offsuit',
    };
  }),
);

/** `base` with every combo of `cls` at `weight`, as a new range. */
function painted(base: WeightedRange, cls: HandClass, weight: number): WeightedRange {
  const next = createRange(base.weights, base.label);
  for (const combo of HAND_CLASS_COMBOS[cls]!) next.weights[combo] = weight;
  return next;
}

/** The weight the stroke in progress paints with (0 for a shift-drag); null between strokes. */
const painting = ref<number | null>(null);
const focused = ref<HandClass>(0);

/** Forget the stroke in progress and stop listening for its end. */
function dropStroke(): void {
  window.removeEventListener('pointerup', endStroke);
  window.removeEventListener('pointercancel', endStroke);
  draft.value = null;
  painting.value = null;
}

/** The pointer lifted, or the browser took it back: the whole stroke is one edit, if it changed a weight. */
function endStroke(): void {
  const stroke = draft.value;
  dropStroke();
  if (stroke !== null && stroke.weights.some((weight, combo) => weight !== props.range.weights[combo])) emit('update:range', stroke);
}

function onPointerDown(cls: HandClass, event: PointerEvent): void {
  emit('cellClick', cls);
  if (props.mode !== 'edit') return;
  event.preventDefault();
  painting.value = event.shiftKey ? 0 : props.brush;
  // A stroke whose pointerup never arrived (released outside the window) carries on, not lost.
  draft.value = painted(draft.value ?? props.range, cls, painting.value);
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);
}

function onPointerEnter(cls: HandClass): void {
  emit('cellHover', cls);
  if (draft.value !== null && painting.value !== null) draft.value = painted(draft.value, cls, painting.value);
}

const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -RANK_COUNT, ArrowDown: RANK_COUNT };

function onKeydown(event: KeyboardEvent): void {
  const move = MOVES[event.key];
  if (move !== undefined) {
    const next = focused.value + move;
    if (next >= 0 && next < RANK_COUNT * RANK_COUNT) {
      focused.value = next;
      (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-cls="${next}"]`)?.focus();
    }
    event.preventDefault();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    // The keyboard's click: selects the cell wherever a page listens, and toggles it in edit mode.
    emit('cellClick', focused.value);
    if (props.mode === 'edit') emit('update:range', painted(props.range, focused.value, cells.value[focused.value]!.fill > 0 ? 0 : props.brush));
    event.preventDefault();
  }
}

onBeforeUnmount(dropStroke);

function title(cell: Cell): string {
  const parts = [`${cell.name}: ${cell.count} of ${cell.possible} combos`];
  if (cell.fill > 0) parts.push(`weight ${(100 * cell.fill).toFixed(0)}%`);
  if (cell.heat !== null) parts.push(`${props.heatmapLabel || 'value'} ${props.heatmapSigned && cell.heat > 0 ? '+' : ''}${(100 * cell.heat).toFixed(1)}%`);
  if (cell.blocked > 0) parts.push(`${Math.round(cell.blocked * cell.possible)} blocked`);
  return parts.join(' · ');
}
</script>

<template>
  <div class="pk-matrix" role="grid" :aria-label="range.label ?? 'hand matrix'" tabindex="-1" @keydown="onKeydown" @pointerleave="emit('cellHover', null)">
    <button
      v-for="cell in cells"
      :key="cell.cls"
      type="button"
      role="gridcell"
      class="pk-cell"
      :class="[`pk-${cell.kind}`, { 'pk-selected': cell.cls === selectedClass, 'pk-view': mode === 'view' }]"
      :data-cls="cell.cls"
      :tabindex="cell.cls === focused ? 0 : -1"
      :aria-label="title(cell)"
      :title="title(cell)"
      @pointerdown="onPointerDown(cell.cls, $event)"
      @pointerenter="onPointerEnter(cell.cls)"
      @focus="focused = cell.cls"
    >
      <span class="pk-fill" :style="{ height: `${100 * cell.fill}%` }" />
      <span v-if="cell.heat !== null" class="pk-heat" :class="{ 'pk-heat-more': heatmapSigned && cell.heat > 0, 'pk-heat-less': heatmapSigned && cell.heat < 0 }" :style="{ opacity: 0.15 + 0.6 * Math.abs(cell.heat) }" />
      <span v-if="cell.blocked > 0" class="pk-blocked" :style="{ width: `${100 * cell.blocked}%` }" />
      <span v-if="cell.highlight > 0" class="pk-highlight" :style="{ opacity: 0.35 + 0.65 * cell.highlight }" />
      <span class="pk-label">{{ cell.name }}</span>
    </button>
  </div>
</template>

<style scoped>
.pk-matrix {
  display: grid;
  grid-template-columns: repeat(13, minmax(0, 1fr));
  gap: 1px;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  background: var(--pk-border, #d4d4d8);
  border: 1px solid var(--pk-border, #d4d4d8);
  user-select: none;
  touch-action: none;
}
.pk-cell {
  position: relative;
  overflow: hidden;
  padding: 0;
  border: 0;
  font: inherit;
  font-size: clamp(8px, 1.1vw, 12px);
  color: var(--pk-fg, #18181b);
  background: var(--pk-surface, #f4f4f5);
  cursor: pointer;
}
.pk-cell.pk-view {
  cursor: default;
}
.pk-cell:focus-visible {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: -2px;
  z-index: 1;
}
.pk-pair {
  background: color-mix(in srgb, var(--pk-pair, #fde68a) 35%, var(--pk-surface, #f4f4f5));
}
.pk-suited {
  background: color-mix(in srgb, var(--pk-suited, #bfdbfe) 35%, var(--pk-surface, #f4f4f5));
}
.pk-offsuit {
  background: color-mix(in srgb, var(--pk-offsuit, #fecaca) 35%, var(--pk-surface, #f4f4f5));
}
.pk-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--pk-fill, #86efac);
}
.pk-heat {
  position: absolute;
  inset: 0;
  background: hsl(var(--pk-heat, 220 80% 50%));
}
.pk-heat-more {
  background: hsl(var(--pk-diff-more, 160 60% 38%));
}
.pk-heat-less {
  background: hsl(var(--pk-diff-less, 330 70% 48%));
}
.pk-blocked {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: repeating-linear-gradient(135deg, var(--pk-blocked, #a1a1aa) 0 2px, transparent 2px 5px);
  opacity: 0.7;
}
.pk-highlight {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 0 2px var(--pk-highlight, #f59e0b);
}
.pk-selected {
  box-shadow: inset 0 0 0 2px var(--pk-accent, #2563eb);
}
.pk-label {
  position: relative;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
