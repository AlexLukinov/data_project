<script setup lang="ts">
/**
 * The recent uploads as the server holds them (plan D.8): every file, what it was sent as, where
 * it stands and how many hands it gave. A failed file shows the server's reason, and a My hands
 * file whose hands were not recognised as the uploader's says so, because those hands are
 * missing from My game and nothing else on the screen would reveal it.
 */
import { computed } from 'vue';

import type { UploadRow, UploadStatus } from '~/upload/api';
import type { Tone } from '~/upload/status';
import { DATASET_LABELS, describeRow, uploadedAt } from '~/upload/status';

const props = defineProps<{ rows: UploadRow[] }>();

const STATUS_LABELS: Record<UploadStatus, string> = {
  queued: 'Waiting',
  processing: 'Reading',
  completed: 'Done',
  failed: 'Failed',
};

const DETAIL_CLASSES: Record<Tone, string> = {
  wait: 'text-zinc-500',
  ok: 'text-zinc-500',
  warn: 'text-amber-700 dark:text-amber-300',
  fail: 'text-red-600 dark:text-red-400',
};

const lines = computed(() => props.rows.map((row) => ({ row, state: describeRow(row, { waitedMs: 0 }) })));

const count = (n: number) => n.toLocaleString('en-US');
</script>

<template>
  <p v-if="rows.length === 0" class="text-sm text-zinc-500" data-testid="uploads-empty">No uploads yet. Drop your first hand-history file above.</p>
  <div v-else class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
    <table class="w-full text-sm" data-testid="upload-list">
      <thead class="text-left text-xs text-zinc-500">
        <tr>
          <th class="p-2">file</th>
          <th class="p-2">dataset</th>
          <th class="p-2">site</th>
          <th class="p-2">status</th>
          <th class="p-2 text-right">found / stored / failed</th>
          <th class="p-2">uploaded</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ row, state } in lines" :key="row.upload_id" class="border-t border-zinc-200 align-top dark:border-zinc-800" :data-testid="`upload-row-${row.upload_id}`" :data-status="row.status">
          <td class="p-2 font-mono text-xs break-all">{{ row.filename }}</td>
          <td class="p-2">{{ row.dataset === null ? '—' : DATASET_LABELS[row.dataset] }}</td>
          <td class="p-2">{{ row.site || '—' }}</td>
          <td class="p-2">
            <span>{{ STATUS_LABELS[row.status] }}</span>
            <p v-if="state.detail" class="mt-1 max-w-md text-xs" :class="DETAIL_CLASSES[state.tone]" data-testid="upload-row-detail">{{ state.detail }}</p>
          </td>
          <td class="p-2 text-right tabular-nums">{{ count(row.hands_found) }} / {{ count(row.hands_parsed) }} / {{ count(row.hands_failed) }}</td>
          <td class="p-2 whitespace-nowrap tabular-nums">{{ uploadedAt(row.created_at) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
