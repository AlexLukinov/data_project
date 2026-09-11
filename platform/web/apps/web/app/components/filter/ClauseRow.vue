<script setup lang="ts">
/**
 * One condition: what it is about, how it compares, what it compares to, and why it cannot be
 * sent yet (plan D.3). The op list is the server's `allowed_ops` — narrowed per dimension in the
 * registry, so the picker cannot offer `gt` on an enum or `prefix` on a number and earn a 400.
 */
import { computed } from 'vue';

import type { Dimension } from '~/stats/api';
import type { Clause, ClauseOp } from '~/filter/clause';
import { BUCKET_OP, opsFor, withOp } from '~/filter/clause';
import { clauseProblem } from '~/filter/label';
import ClauseValue from './ClauseValue.vue';

const props = defineProps<{ clause: Clause; dim: Dimension | undefined }>();
const emit = defineEmits<{ change: [clause: Clause]; remove: [] }>();

const ops = computed(() => (props.dim === undefined ? [] : opsFor(props.dim)));
const problem = computed(() => clauseProblem(props.clause, props.dim));

const OP_TEXT: Record<string, string> = {
  bucket: 'in range',
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  lt: 'is below',
  lte: 'is at most',
  gt: 'is above',
  gte: 'is at least',
  between: 'is between',
  prefix: 'starts with',
  like: 'matches',
};

function setOp(op: string): void {
  if (props.dim === undefined) return;
  emit('change', withOp(props.clause, op as ClauseOp, props.dim));
}
</script>

<template>
  <li class="flex flex-wrap items-center gap-2 border-t border-zinc-200 py-2 text-sm first:border-t-0 dark:border-zinc-800" :data-testid="`clause-${clause.dim}`">
    <span class="min-w-40 font-medium" :title="dim?.description">{{ dim?.label ?? clause.dim }}</span>

    <select v-if="dim" :value="clause.op" :aria-label="`how to compare ${dim.label}`" data-testid="clause-op" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @change="setOp(($event.target as HTMLSelectElement).value)">
      <option v-for="op in ops" :key="op" :value="op">{{ OP_TEXT[op] ?? op }}</option>
    </select>

    <ClauseValue v-if="dim" :clause="clause" :dim="dim" @update:values="emit('change', { ...clause, values: $event })" />
    <span v-else class="text-zinc-500">{{ clause.op }} {{ clause.values.join(', ') }}</span>

    <span v-if="dim && clause.op === BUCKET_OP" class="text-xs text-zinc-500">half-open: the high end belongs to the next range</span>

    <button type="button" :aria-label="`remove ${dim?.label ?? clause.dim}`" data-testid="clause-remove" class="ml-auto rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" @click="emit('remove')">×</button>

    <p v-if="problem" role="alert" data-testid="clause-problem" class="w-full text-xs text-amber-700 dark:text-amber-400">{{ problem }}</p>
  </li>
</template>
