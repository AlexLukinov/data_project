<script setup lang="ts">
// Bulk import (spec §11.2): drop a folder, review every inferred situation in a table, correct
// what is wrong, then commit. Nothing is saved before the review; the report says what landed.
import type { NodeKey } from '@poker/core';
import { nodeKey } from '@poker/core';
import type { ImporterId } from '@poker/importers';
import { importFiles } from '@poker/importers';
import { NodeKeyEditor, RangeMatrix } from '@poker/ui';
import { computed, ref } from 'vue';

import { describeApiError } from '~/auth/api';
import ImportReviewTable from '~/components/ranges/ImportReviewTable.vue';
import type { BulkOut, OnConflict, RangeSource } from '~/ranges/api';
import type { PathedFile } from '~/ranges/files';
import { UNREADABLE_DROP, collectEntries, entriesOf, pickedFiles, readImportFiles } from '~/ranges/files';
import type { ReviewRow } from '~/ranges/review';
import { applyToAll, buildReview, duplicateNames, reviewSummary, toBulkBody } from '~/ranges/review';
import { useRangesStore } from '~/stores/ranges';

const store = useRangesStore();
const rows = ref<ReviewRow[]>([]);
const selectedId = ref<number | null>(null);
const importer = ref<'auto' | ImporterId>('auto');
const batchSource = ref<RangeSource>('own');
const batchTool = ref('');
const batchTags = ref('');
const onConflict = ref<OnConflict>('version');
const report = ref<BulkOut | null>(null);
const problem = ref<string | null>(null);
/**
 * A drop or a pick the browser would not open. It is said by the drop area rather than beside the
 * Save button, because nothing was read and the whole review section below stays unrendered.
 */
const readProblem = ref<string | null>(null);
const busy = ref(false);

const summary = computed(() => reviewSummary(rows.value));
const duplicates = computed(() => duplicateNames(rows.value));
const selected = computed(() => rows.value.find((r) => r.id === selectedId.value) ?? null);

/**
 * Walk what was handed over and read it. Every step of that is the browser's to refuse — a folder
 * it will not list, a file that moved since the drag began — and an unread drop used to leave the
 * page exactly as it was, as if nothing had been dropped on it at all.
 */
async function load(collect: () => Promise<PathedFile[]>): Promise<void> {
  report.value = problem.value = readProblem.value = null;
  try {
    const texts = await readImportFiles(await collect());
    rows.value = buildReview(importFiles(texts, importer.value === 'auto' ? {} : { importer: importer.value }));
    selectedId.value = rows.value[0]?.id ?? null;
  } catch {
    rows.value = [];
    selectedId.value = null;
    readProblem.value = UNREADABLE_DROP;
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  const transfer = event.dataTransfer;
  if (transfer === null) return;
  await load(() => collectEntries(entriesOf(transfer)));
}

async function onPick(event: Event): Promise<void> {
  const list = (event.target as HTMLInputElement).files;
  if (list !== null) await load(async () => pickedFiles(list));
}

function patch(id: number, change: Partial<ReviewRow>): void {
  rows.value = rows.value.map((r) => (r.id === id ? { ...r, ...change } : r));
}

function setKey(id: number, key: NodeKey): void {
  patch(id, { key });
}

function applyBatch(): void {
  const tags = batchTags.value.split(',').map((t) => t.trim()).filter((t) => t !== '');
  rows.value = applyToAll(rows.value, { source: batchSource.value, sourceTool: batchTool.value, tags });
}

async function commit(): Promise<void> {
  busy.value = true;
  problem.value = null;
  try {
    report.value = await store.importBulk(toBulkBody(rows.value, onConflict.value));
  } catch (e) {
    // Not `describeLibraryError`: this is a write, and the offline copy cannot stand in for one,
    // so "showing the cached copy" would promise a saved range that was never saved.
    problem.value = `Nothing was saved to the library. ${describeApiError(e)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center gap-3">
      <NuxtLink to="/ranges" class="text-sm text-zinc-500 hover:underline">← library</NuxtLink>
      <h1 class="text-2xl font-semibold">Import ranges</h1>
    </div>

    <div
      class="rounded-lg border-2 border-dashed border-zinc-300 p-6 text-center text-sm dark:border-zinc-700"
      data-testid="import-drop"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <p>Drop a folder of range files here — Simple Preflop Holdem text, GTO Wizard, PioSOLVER, Equilab, CSV, or a backup JSON.</p>
      <p class="mt-2 text-zinc-500">
        or pick
        <label class="cursor-pointer underline">a folder<input type="file" class="sr-only" multiple webkitdirectory data-testid="import-folder" @change="onPick" /></label>
        /
        <label class="cursor-pointer underline">files<input type="file" class="sr-only" multiple data-testid="import-files" @change="onPick" /></label>
      </p>
      <label class="mt-3 inline-block text-xs text-zinc-500">read every file as
        <select v-model="importer" class="ml-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" aria-label="importer">
          <option value="auto">detected per file</option>
          <option value="sph">Simple Preflop Holdem text</option>
          <option value="gtowizard">GTO Wizard</option>
          <option value="pio">PioSOLVER</option>
          <option value="equilab">Equilab / Flopzilla</option>
          <option value="csv">CSV</option>
          <option value="json">backup JSON</option>
          <option value="text">plain text</option>
        </select>
      </label>
    </div>

    <p v-if="readProblem" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="import-read-error">{{ readProblem }}</p>

    <template v-if="rows.length > 0 && !report">
      <p class="text-sm" data-testid="import-summary">
        {{ summary.total }} range{{ summary.total === 1 ? '' : 's' }} read · {{ summary.ready }} ready · {{ summary.needsSituation }} need a situation · {{ summary.failed }} failed · <strong>{{ summary.sending }} will be saved</strong>
      </p>
      <p v-if="duplicates.length" role="alert" class="text-sm text-amber-700 dark:text-amber-300">Named twice, only the first is saved: {{ duplicates.join(', ') }}</p>

      <div class="flex flex-wrap items-end gap-2 text-sm">
        <label>source for all
          <select v-model="batchSource" class="ml-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700">
            <option value="own">my charts</option>
            <option value="solver">solver</option>
            <option value="pool">pool</option>
          </select>
        </label>
        <label>tool <input v-model="batchTool" type="text" placeholder="Simple Preflop Holdem" class="ml-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" /></label>
        <label>tags <input v-model="batchTags" type="text" placeholder="6max, 2026" class="ml-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" /></label>
        <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700" data-testid="import-apply-all" @click="applyBatch">Apply to all</button>
        <label class="ml-auto">a name already in the library
          <select v-model="onConflict" class="ml-1 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700" data-testid="import-conflict">
            <option value="version">gets a new version</option>
            <option value="skip">is skipped</option>
          </select>
        </label>
      </div>

      <ImportReviewTable :rows="rows" :selected-id="selectedId" @patch="patch" @select="selectedId = $event" />

      <div v-if="selected && selected.range" class="grid gap-6 rounded-lg border border-zinc-200 p-4 lg:grid-cols-[minmax(0,1fr)_24rem] dark:border-zinc-800" data-testid="import-selected">
        <div>
          <h2 class="mb-2 text-sm font-medium">{{ selected.name }} <span class="text-zinc-500">· {{ selected.file }}</span></h2>
          <RangeMatrix :range="selected.range" mode="view" />
        </div>
        <div>
          <NodeKeyEditor v-if="selected.key" :model-value="selected.key" @update:model-value="setKey(selected.id, $event)" />
          <button v-else type="button" class="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700" data-testid="import-add-situation" @click="setKey(selected.id, nodeKey('UTG'))">Add a situation</button>
        </div>
      </div>

      <p v-if="problem" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="import-problem">{{ problem }}</p>
      <button type="button" data-testid="import-commit" :disabled="busy || summary.sending === 0" class="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900" @click="commit">
        Save {{ summary.sending }} range{{ summary.sending === 1 ? '' : 's' }} to the library
      </button>
    </template>

    <div v-if="report" class="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800" data-testid="import-report">
      <h2 class="font-medium">Import report</h2>
      <p>{{ report.created.length }} created · {{ report.updated.length }} given a new version · {{ report.skipped.length }} skipped · {{ summary.failed }} file{{ summary.failed === 1 ? '' : 's' }} failed to read</p>
      <ul v-if="report.skipped.length" class="list-inside list-disc text-zinc-600 dark:text-zinc-400">
        <li v-for="s in report.skipped" :key="s.name">{{ s.name }}: {{ s.reason }}</li>
      </ul>
      <ul v-if="summary.failed" class="list-inside list-disc text-zinc-600 dark:text-zinc-400">
        <li v-for="r in rows.filter((x) => x.error)" :key="r.id">{{ r.file }}: {{ r.error }}</li>
      </ul>
      <NuxtLink to="/ranges" class="inline-block underline">Open the library</NuxtLink>
    </div>
  </section>
</template>
