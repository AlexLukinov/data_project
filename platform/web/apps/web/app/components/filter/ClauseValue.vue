<script setup lang="ts">
/**
 * The value half of one condition, rendered the way the dimension's own type asks for
 * (plan D.3). Every branch here is chosen from `/v1/definitions`, never from a list of
 * dimension codes: an enum offers its own `values`, a bucketed number offers its own bucket
 * names, a `line` gets the action-line control, a bool gets yes/no.
 *
 * Two shapes are recognised by their vocabulary rather than by name, so a registry addition is
 * handled on the day it ships: a seat enum is any enum that lists the seats, and it gets the
 * `PositionPicker`; everything else falls back to a select or a text box.
 *
 * What a choice **shows** and what it **sends** are two different strings (ADR-053): the text is
 * the registry's words — `small (under 0.37 of the pot)`, `5bet+` — and the value is the
 * registry's own code, unchanged, so a value read here and a value sent still agree.
 */
import { computed, ref } from 'vue';
import { ActionLine, NumberInput, PositionPicker, formatDecimal, parseDecimal } from '@poker/ui';

import type { Dimension } from '~/stats/api';
import { bucketWords, valueWords } from '~/stats/vocabulary';
import type { Clause } from '~/filter/clause';
import { BUCKET_OP, arity } from '~/filter/clause';

const props = defineProps<{ clause: Clause; dim: Dimension }>();
const emit = defineEmits<{ 'update:values': [values: string[]] }>();

const listOp = computed(() => props.clause.op === 'in' || props.clause.op === 'not_in');
const isSeat = computed(() => props.dim.type === 'enum' && props.dim.values.includes('BTN') && props.dim.values.includes('SB'));
/** `line_so_far` is the one line dimension that joins streets with '/'; the others are one street. */
const multiStreet = computed(() => props.dim.code === 'line_so_far');
const buckets = computed(() => Object.keys(props.dim.buckets));

function at(index: number): string {
  return props.clause.values[index] ?? '';
}

function put(index: number, value: string): void {
  const values = [...props.clause.values];
  while (values.length <= index) values.push('');
  values[index] = value;
  emit('update:values', values.slice(0, arity(props.clause.op) ?? values.length));
}

/** A number box's reading of value `index`: `null` while that value is empty or not a number. */
function numberAt(index: number): number | null {
  return parseDecimal(at(index));
}

/** A typed number is kept as this app writes it, so `45,5` is sent as `45.5`. */
function putNumber(index: number, value: number): void {
  put(index, formatDecimal(value));
}

function toggleEnum(value: string): void {
  const chosen = new Set(props.clause.values);
  if (chosen.has(value)) chosen.delete(value);
  else chosen.add(value);
  emit('update:values', props.dim.values.filter((v) => chosen.has(v)));
}

/**
 * A list of numbers (`big_blind in 0.05; 0.1`) is separated by `;` or spaces, never by commas: a
 * comma may be the reader's decimal point, and `0,05, 0,1` split on commas is four wrong numbers.
 */
const NUMBER_LIST_SEPARATOR = /[;\s]+/;
const numberListInvalid = ref(false);

/** Sends the list only when every item reads as a number; otherwise marks the box and sends nothing. */
function putNumbers(text: string): void {
  const numbers = text.split(NUMBER_LIST_SEPARATOR).filter((part) => part !== '').map(parseDecimal);
  numberListInvalid.value = numbers.some((value) => value === null);
  if (numberListInvalid.value) return;
  emit('update:values', numbers.filter((value): value is number => value !== null).map(formatDecimal));
}

/** A free-text list (`stake_level in NL10, NL25`) — the one place a comma is the separator. */
function putList(text: string): void {
  emit('update:values', text.split(',').map((part) => part.trim()).filter((part) => part !== ''));
}
</script>

<template>
  <select v-if="clause.op === BUCKET_OP" :value="at(0)" :aria-label="`${dim.label} range`" data-testid="clause-bucket" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @change="put(0, ($event.target as HTMLSelectElement).value)">
    <option v-for="name in buckets" :key="name" :value="name">{{ bucketWords(dim, name) }}</option>
  </select>

  <PositionPicker
    v-else-if="isSeat"
    :seats="dim.values"
    :selected="clause.values"
    :multiple="listOp"
    :label="dim.label"
    @update:selected="emit('update:values', $event)"
  />

  <div v-else-if="dim.type === 'bool'" class="flex gap-1 text-sm">
    <button v-for="option in [['1', 'yes'], ['0', 'no']]" :key="option[0]" type="button" :data-testid="`clause-bool-${option[1]}`" :aria-pressed="at(0) === option[0]" class="rounded border px-2 py-1" :class="at(0) === option[0] ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'" @click="put(0, option[0]!)">{{ option[1] }}</button>
  </div>

  <div v-else-if="dim.type === 'enum' && listOp" class="flex flex-wrap gap-1 text-sm" data-testid="clause-enum-many">
    <button v-for="value in dim.values" :key="value" type="button" :aria-pressed="clause.values.includes(value)" class="rounded border px-2 py-0.5" :class="clause.values.includes(value) ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'" @click="toggleEnum(value)">{{ valueWords(dim, value) }}</button>
  </div>

  <select v-else-if="dim.type === 'enum'" :value="at(0)" :aria-label="dim.label" data-testid="clause-enum" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @change="put(0, ($event.target as HTMLSelectElement).value)">
    <option v-for="value in dim.values" :key="value" :value="value">{{ valueWords(dim, value) }}</option>
  </select>

  <ActionLine
    v-else-if="dim.type === 'line'"
    :line="at(0)"
    mode="edit"
    :streets="multiStreet"
    :label="dim.label"
    @update:line="put(0, $event)"
  />

  <div v-else-if="clause.op === 'between'" class="flex items-center gap-1 text-sm">
    <NumberInput :model-value="numberAt(0)" :aria-label="`${dim.label} low`" data-testid="clause-low" class="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @update:model-value="putNumber(0, $event)" @clear="put(0, '')" />
    <span class="text-zinc-500">and</span>
    <NumberInput :model-value="numberAt(1)" :aria-label="`${dim.label} high`" data-testid="clause-high" class="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @update:model-value="putNumber(1, $event)" @clear="put(1, '')" />
  </div>

  <input
    v-else-if="listOp && dim.type === 'number'"
    :value="clause.values.join('; ')"
    type="text"
    inputmode="decimal"
    :aria-label="dim.label"
    :aria-invalid="numberListInvalid ? 'true' : undefined"
    :title="numberListInvalid ? 'Numbers separated by ; or spaces — 0.05 and 0,05 both work.' : undefined"
    data-testid="clause-number-list"
    placeholder="0.05; 0.1"
    class="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm aria-invalid:border-red-600 dark:border-zinc-700 dark:aria-invalid:border-red-400"
    @change="putNumbers(($event.target as HTMLInputElement).value)"
  />

  <input v-else-if="listOp" :value="clause.values.join(', ')" type="text" :aria-label="dim.label" data-testid="clause-list" placeholder="comma separated" class="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" @change="putList(($event.target as HTMLInputElement).value)" />

  <NumberInput v-else-if="dim.type === 'number'" :model-value="numberAt(0)" :aria-label="dim.label" data-testid="clause-scalar" class="w-40 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" @update:model-value="putNumber(0, $event)" @clear="put(0, '')" />

  <input v-else :value="at(0)" type="text" :aria-label="dim.label" data-testid="clause-scalar" class="w-40 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" @input="put(0, ($event.target as HTMLInputElement).value)" />
</template>
