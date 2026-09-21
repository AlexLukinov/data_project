<script setup lang="ts">
// One stored range: edit the matrix and the situation, save (a body change makes a new version),
// browse the history and revert, delete. Spec §11.1: "editing a range creates a new version;
// keep history and allow revert". The body's edits also undo and redo (spec §13) — in the
// browser, before a save; the version history is the server's record after one.
import type { NodeKey, WeightedRange } from '@poker/core';
import { nodeKeyEquals, parseRange, serializeRange } from '@poker/core';
import { NodeKeyEditor, NodeLabel, RangeMatrix, RangeTextIO, useUndoRedo, useUndoShortcuts } from '@poker/ui';
import { computed, ref, watch } from 'vue';

import type { RangeSource, StoredRange } from '~/ranges/api';
import { describeLibraryError } from '~/ranges/library';
import { useRangesStore } from '~/stores/ranges';

const store = useRangesStore();
const id = useRoute().params.id as string;
const { data, error, refresh } = await useAsyncData(`range-${id}`, () => store.open(id), { server: false, lazy: true });
const { data: history, refresh: refreshHistory } = await useAsyncData(`range-${id}-versions`, () => store.versions(id).catch(() => []), { server: false, lazy: true });

const name = ref('');
const key = ref<NodeKey | null>(null);
const source = ref<RangeSource>('own');
const sourceTool = ref('');
const tagsText = ref('');
const note = ref('');
const edits = useUndoRedo<WeightedRange | null>(null);
const range = computed(() => edits.state.value);
const message = ref<string | null>(null);
const problem = ref<string | null>(null);

/** Two bodies are the same when they would be stored as the same text — what a version compares. */
function sameBody(a: WeightedRange | null, b: WeightedRange | null): boolean {
  return a !== null && b !== null && serializeRange(a, 'combo') === serializeRange(b, 'combo');
}

function reset(r: StoredRange | undefined): void {
  if (r === undefined) return;
  name.value = r.name;
  key.value = r.node_key;
  source.value = r.source;
  sourceTool.value = r.source_tool;
  tagsText.value = r.tags.join(', ');
  // A save of the edited body comes back as that same body and keeps the undo; a load or a
  // revert brings another body and starts it again.
  edits.sync({ ...parseRange(r.weights).range, label: r.name }, sameBody);
  // A rename alone keeps the body, and with it the label the range was carrying — which the matrix
  // uses as its accessible name. Put the saved name on it without touching the history, which is
  // what `reset` would do.
  const kept = edits.state.value;
  if (kept !== null && kept.label !== r.name) edits.state.value = { ...kept, label: r.name };
  note.value = '';
}
watch(data, reset, { immediate: true });
useUndoShortcuts(() => edits);

const weightsText = computed(() => (range.value === null ? '' : serializeRange(range.value, 'combo')));
/**
 * Against the stored body *as this page would write it*, not against its text. A range that was
 * imported or posted in another notation ("AsKs: 1,AhKh: 1") holds the same combos as the text
 * this page serializes ("AsKs,AhKh"), and comparing the two strings made an untouched page offer
 * "Save as v2" — and left one offered after an undo that had put every combo back.
 */
const storedText = computed(() => (data.value === undefined ? '' : serializeRange(parseRange(data.value.weights).range, 'combo')));
const bodyChanged = computed(() => data.value !== undefined && weightsText.value !== storedText.value);
const tags = computed(() => tagsText.value.split(',').map((t) => t.trim()).filter((t) => t !== ''));
const dirty = computed(() => {
  const r = data.value;
  if (r === undefined || key.value === null) return false;
  return bodyChanged.value || name.value !== r.name || !nodeKeyEquals(key.value, r.node_key) || source.value !== r.source || sourceTool.value !== r.source_tool || tags.value.join(',') !== r.tags.join(',');
});

async function save(): Promise<void> {
  if (key.value === null) return;
  message.value = problem.value = null;
  const newVersion = bodyChanged.value;
  try {
    await store.update(id, { name: name.value, node_key: key.value, source: source.value, source_tool: sourceTool.value, tags: tags.value, ...(newVersion ? { weights: weightsText.value, note: note.value } : {}) });
    await Promise.all([refresh(), refreshHistory()]);
    message.value = newVersion ? 'Saved as a new version.' : 'Saved.';
  } catch (e) {
    problem.value = describeLibraryError(e);
  }
}

async function revert(version: number): Promise<void> {
  message.value = problem.value = null;
  try {
    await store.revert(id, version);
    await Promise.all([refresh(), refreshHistory()]);
    message.value = `Reverted to v${version} as a new version.`;
  } catch (e) {
    problem.value = describeLibraryError(e);
  }
}

async function remove(): Promise<void> {
  if (!window.confirm(`Delete "${data.value?.name}" and its whole history?`)) return;
  try {
    await store.remove(id);
    await navigateTo('/ranges');
  } catch (e) {
    problem.value = describeLibraryError(e);
  }
}

function setRange(next: WeightedRange): void {
  edits.set({ ...next, label: name.value });
}
</script>

<template>
  <section class="space-y-4">
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">Could not load the range: {{ describeLibraryError(error) }}</p>
    <template v-else-if="data && key && range">
      <div class="flex flex-wrap items-center gap-3">
        <NuxtLink to="/ranges" class="text-sm text-zinc-500 hover:underline">← library</NuxtLink>
        <input v-model="name" type="text" aria-label="name" data-testid="range-name" class="min-w-64 rounded border border-zinc-300 bg-transparent px-2 py-1 text-xl font-semibold dark:border-zinc-700" />
        <span class="text-sm text-zinc-500" data-testid="range-version">v{{ data.version }}</span>
        <span class="ml-auto flex gap-2 text-sm">
          <NuxtLink :to="`/ranges/compare?range=${id}`" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Compare at this situation</NuxtLink>
          <button type="button" data-testid="range-undo" :disabled="!edits.canUndo.value" title="⌘Z" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="edits.undo()">Undo</button>
          <button type="button" data-testid="range-redo" :disabled="!edits.canRedo.value" title="⌘⇧Z" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="edits.redo()">Redo</button>
          <button type="button" data-testid="range-save" :disabled="!dirty" class="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900" @click="save">Save{{ bodyChanged ? ' as v' + (data.version + 1) : '' }}</button>
          <button type="button" data-testid="range-delete" class="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950" @click="remove">Delete</button>
        </span>
      </div>
      <p v-if="message" role="status" data-testid="range-message" class="text-sm text-emerald-700 dark:text-emerald-300">{{ message }}</p>
      <p v-if="problem" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ problem }}</p>
      <p v-if="store.status === 'offline'" role="status" class="text-sm text-amber-700 dark:text-amber-300">{{ store.error }}</p>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-3">
          <RangeMatrix :range="range" @update:range="setRange" />
          <RangeTextIO :range="range" @update:range="setRange" />
          <label v-if="bodyChanged" class="block text-sm">what changed
            <input v-model="note" type="text" maxlength="500" placeholder="added the suited connectors" data-testid="range-note" class="mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
        </div>
        <div class="space-y-4 text-sm">
          <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <NodeKeyEditor v-model="key" />
          </div>
          <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            <label for="range-source">source</label>
            <select id="range-source" v-model="source" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
              <option value="own">my chart</option>
              <option value="solver">solver</option>
              <option value="pool">pool</option>
            </select>
            <label for="range-tool">tool</label>
            <input id="range-tool" v-model="sourceTool" type="text" maxlength="120" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
            <label for="range-tags">tags</label>
            <input id="range-tags" v-model="tagsText" type="text" placeholder="rfi, 6max" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </div>
          <div>
            <h2 class="mb-1 font-medium">History</h2>
            <ol class="space-y-1" data-testid="range-history">
              <li v-for="v in history ?? []" :key="v.version" class="flex items-center gap-2">
                <span class="tabular-nums">v{{ v.version }}</span>
                <span class="text-zinc-500">{{ v.created_at.slice(0, 16).replace('T', ' ') }}</span>
                <span class="truncate text-zinc-500">{{ v.note }}</span>
                <button v-if="v.version !== data.version" type="button" class="ml-auto text-xs underline" :data-testid="`range-revert-${v.version}`" @click="revert(v.version)">revert</button>
                <span v-else class="ml-auto text-xs text-zinc-500">current</span>
              </li>
            </ol>
          </div>
          <p class="text-xs text-zinc-500"><NodeLabel :node="key" /> · {{ data.source_tool || 'no tool named' }}</p>
        </div>
      </div>
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="range-loading">Opening the range…</p>
  </section>
</template>
