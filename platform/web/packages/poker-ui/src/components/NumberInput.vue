<script setup lang="ts">
/**
 * A number the reader types (ADR-053). `<input type="number">` shows its value in the browser's
 * own locale — `2,5` on a `ru_RU` Chrome, whatever `lang` the page declares — while everything
 * this app prints writes `2.5`. This is a text box in `inputmode="decimal"` instead: it reads
 * `2.5` and `2,5` alike, writes the value back with a dot once the reader leaves it, and never
 * emits a number it could not read. Unreadable or out-of-range text is marked `aria-invalid`
 * and the last good value stands.
 *
 * `v-model` of a number. Emptying the box emits `clear` rather than `null`, so a value that can
 * never be empty binds `v-model` alone and one that can listens for `clear` too. `lazy` emits on
 * change (Enter, or leaving the box) instead of on every keystroke. ArrowUp and ArrowDown step
 * by `step` within `min` and `max`, as the native input did. Every other attribute — `class`,
 * `aria-label`, `placeholder`, `disabled`, `data-testid`, a `keyup.enter` — lands on the input.
 */
import { computed, ref, watch } from 'vue';

import { cleanDecimal, formatDecimal, parseDecimal, sameDecimal } from '../number';

const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    min?: number;
    max?: number;
    /** What one ArrowUp or ArrowDown adds or takes away. */
    step?: number;
    lazy?: boolean;
  }>(),
  { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, step: 1, lazy: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: number]; clear: [] }>();

const text = ref(shown(props.modelValue));
const invalid = ref(false);

function shown(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : formatDecimal(value);
}

/** The box read: a number in range, `'empty'`, or `null` when it is neither. */
function read(raw: string): number | 'empty' | null {
  if (raw.trim() === '') return 'empty';
  const value = parseDecimal(raw);
  return value !== null && value >= props.min && value <= props.max ? value : null;
}

const hint = computed(() => {
  const lower = Number.isFinite(props.min) ? ` from ${formatDecimal(props.min)}` : '';
  const upper = Number.isFinite(props.max) ? ` to ${formatDecimal(props.max)}` : '';
  return `A number${lower}${upper} — 2.5 and 2,5 both work.`;
});

// A change from outside (a reset, an undo, another panel) replaces the text; keystrokes that
// already say this number are left alone, so a half-typed `2,` is not rewritten to `2`.
watch(
  () => props.modelValue,
  (next) => {
    const current = read(text.value);
    if (current === 'empty' ? next === null : current !== null && next !== null && sameDecimal(current, next)) return;
    text.value = shown(next);
    invalid.value = false;
  },
);

function commit(): void {
  const value = read(text.value);
  invalid.value = value === null;
  if (value === 'empty') {
    if (props.modelValue !== null) emit('clear');
  } else if (value !== null && (props.modelValue === null || !sameDecimal(value, props.modelValue))) {
    emit('update:modelValue', value);
  }
}

function onInput(event: Event): void {
  text.value = (event.target as HTMLInputElement).value;
  if (props.lazy) invalid.value = read(text.value) === null;
  else commit();
}

/** Every keystroke has already been committed unless the box is lazy. */
function onChange(): void {
  if (props.lazy) commit();
}

/**
 * Leaving the box writes back the value in use, with a dot: `2,5` becomes `2.5`, and text that
 * was never a number gives way to the number that stood — the screen shows what is computed.
 */
function onBlur(): void {
  invalid.value = false;
  text.value = shown(props.modelValue);
}

function nudge(event: KeyboardEvent, direction: 1 | -1): void {
  event.preventDefault();
  const current = read(text.value);
  const base = typeof current === 'number' ? current : (props.modelValue ?? 0);
  const next = cleanDecimal(Math.min(props.max, Math.max(props.min, base + direction * props.step)));
  text.value = shown(next);
  invalid.value = false;
  if (props.modelValue === null || !sameDecimal(next, props.modelValue)) emit('update:modelValue', next);
}
</script>

<template>
  <input
    :value="text"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    spellcheck="false"
    :aria-invalid="invalid ? 'true' : undefined"
    :title="invalid ? hint : undefined"
    @input="onInput"
    @change="onChange"
    @blur="onBlur"
    @keydown.up="nudge($event, 1)"
    @keydown.down="nudge($event, -1)"
  />
</template>

<style scoped>
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
input[aria-invalid='true'] {
  border-color: var(--pk-heart, #dc2626);
  outline-color: var(--pk-heart, #dc2626);
}
</style>
