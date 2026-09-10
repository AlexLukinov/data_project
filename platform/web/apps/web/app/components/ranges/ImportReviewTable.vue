<script setup lang="ts">
// The review table of a folder import (spec §11.2): every range with its inferred situation,
// confidence and notes, editable before anything is saved. Rows in, patches out.
import { nodeKeyLabel } from '@poker/core';

import type { ReviewRow } from '~/ranges/review';
import { rowStatus } from '~/ranges/review';

defineProps<{ rows: readonly ReviewRow[]; selectedId: number | null }>();
const emit = defineEmits<{ patch: [id: number, change: Partial<ReviewRow>]; select: [id: number] }>();

const STATUS_TEXT = { ready: 'ready', 'needs-situation': 'needs a situation', failed: 'failed' } as const;
const STATUS_CLASS = {
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  'needs-situation': 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
} as const;
const CONFIDENCE_CLASS = { high: 'text-emerald-700 dark:text-emerald-300', medium: 'text-amber-700 dark:text-amber-300', low: 'text-red-700 dark:text-red-300' } as const;
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-left text-xs text-zinc-500">
        <tr>
          <th class="p-2">save</th>
          <th class="p-2">file</th>
          <th class="p-2">name</th>
          <th class="p-2">situation</th>
          <th class="p-2">status</th>
          <th class="p-2">notes</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-testid="`review-row-${row.id}`"
          class="cursor-pointer border-t border-zinc-200 align-top hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          :class="{ 'bg-zinc-100 dark:bg-zinc-900': row.id === selectedId }"
          @click="emit('select', row.id)"
        >
          <td class="p-2"><input type="checkbox" :checked="row.include" :disabled="rowStatus(row) === 'failed'" :aria-label="`save ${row.name}`" @click.stop @change="emit('patch', row.id, { include: ($event.target as HTMLInputElement).checked })" /></td>
          <td class="p-2 font-mono text-xs text-zinc-500">{{ row.file }}</td>
          <td class="p-2"><input type="text" :value="row.name" :disabled="rowStatus(row) === 'failed'" class="w-48 rounded border border-zinc-300 bg-transparent px-1 dark:border-zinc-700" :aria-label="`name of ${row.file}`" @click.stop @change="emit('patch', row.id, { name: ($event.target as HTMLInputElement).value })" /></td>
          <td class="p-2">
            <span v-if="row.key" :data-testid="`review-situation-${row.id}`">{{ nodeKeyLabel(row.key) }}</span>
            <span v-else class="text-zinc-500">—</span>
            <span v-if="row.confidence" class="ml-2 text-xs" :class="CONFIDENCE_CLASS[row.confidence]">{{ row.confidence }}</span>
          </td>
          <td class="p-2"><span class="rounded px-2 py-0.5 text-xs" :class="STATUS_CLASS[rowStatus(row)]">{{ STATUS_TEXT[rowStatus(row)] }}</span></td>
          <td class="p-2 text-xs text-zinc-600 dark:text-zinc-400">
            <p v-if="row.error" role="alert">{{ row.error }}</p>
            <p v-for="note in row.notes" :key="note">{{ note }}</p>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
