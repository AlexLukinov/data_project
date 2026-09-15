<script setup lang="ts">
/**
 * The files handed over on this visit (plan D.8), sent one at a time and followed until they land.
 *
 * Each file is checked first (`refusal`: a zip, an empty file) and a refused one says why and is
 * never sent. The rest go up **in order, one request at a time**, so a folder of forty files is
 * forty answers read one by one rather than forty uploads racing for the API. Each file keeps the
 * dataset and site that were chosen when it was handed over, whatever the form says later.
 *
 * Once accepted, a file is watched through `~/upload/tracker` and its line reads the server's row
 * through `describeRow`: waiting for the parser, the hands stored so far, the hands in, or the
 * server's own reason for failing. A file that lands says where to look at it, and `settled` tells
 * the page the list of recent uploads is out of date.
 *
 * Once a row has arrived, **the row decides the dataset shown**, not the choice: the same bytes
 * sent again come back as a duplicate of the earlier upload, whose dataset may differ or — for a
 * row from before datasets — be unknown, and then no My game or pool link is offered.
 *
 * **Nothing happens after unmount.** The remaining files are not sent and nothing is polled: a
 * sign-out unmounts this, and a request still queued here would otherwise go out under whichever
 * account signs in next on the same tab.
 */
import { computed, onBeforeUnmount, ref } from 'vue';

import type { PathedFile } from '~/ranges/files';
import type { Dedupe, UploadChoice, UploadRow, UploadStatus, UploadsApi } from '~/upload/api';
import type { RowState } from '~/upload/status';
import { DATASET_LABELS, NO_DATASET_LABEL, dedupeNote, describeRow, describeUploadError, refusal } from '~/upload/status';
import type { Timer, TrackedUpload } from '~/upload/tracker';
import { createUploadTracker } from '~/upload/tracker';

const props = defineProps<{ api: UploadsApi; choice: UploadChoice; timer?: Timer; now?: () => number }>();
const emit = defineEmits<{ settled: [row: UploadRow]; busy: [sending: boolean] }>();

type Stage = 'waiting' | 'sending' | 'refused' | 'error' | 'accepted';

interface QueueItem {
  key: number;
  path: string;
  file: File;
  choice: UploadChoice;
  stage: Stage;
  /** Why it was refused or why the upload failed, as a sentence. */
  problem: string;
  /** The server's status: the 202's, then each tracked row's. */
  status: UploadStatus | null;
  dedupe: Dedupe;
  uploadId: string;
  tracked: TrackedUpload | null;
}

const LINKS = {
  hero: { to: '/', label: 'See them in My game' },
  population: { to: '/pool', label: 'Open the pool' },
} as const;

const TONE_CLASSES: Record<RowState['tone'], string> = {
  wait: 'text-zinc-500',
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-300',
  fail: 'text-red-600 dark:text-red-400',
};

const items = ref<QueueItem[]>([]);
/** The lines for each accepted upload, so a tracker report does not rescan the whole queue. */
const byUpload = new Map<string, QueueItem[]>();
let nextKey = 1;
let draining = false;
let unmounted = false;

const tracker = createUploadTracker(props.api, { timer: props.timer, now: props.now, onChange });
onBeforeUnmount(() => {
  unmounted = true;
  tracker.stop();
});

const lines = computed(() =>
  items.value.map((item) => ({
    item,
    state: stateOf(item),
    status: item.stage === 'accepted' ? (item.status ?? 'queued') : item.stage,
    badge: badgeOf(item),
    link: linkOf(item),
  })),
);

/** Queue files with the dataset and site chosen right now, refusing what must not be sent, and start sending. */
function add(files: PathedFile[]): void {
  const choice = { ...props.choice };
  for (const { path, file } of files) {
    const refused = refusal(file);
    const stage: Stage = refused === null ? 'waiting' : 'refused';
    items.value.push({ key: nextKey++, path, file, choice, stage, problem: refused ?? '', status: null, dedupe: 'new', uploadId: '', tracked: null });
  }
  void drain();
}

defineExpose({ add });

function nextWaiting(): QueueItem | undefined {
  return items.value.find((item) => item.stage === 'waiting');
}

/** Send every waiting file, one request at a time, in the order they were handed over. */
async function drain(): Promise<void> {
  if (draining || unmounted || nextWaiting() === undefined) return;
  draining = true;
  emit('busy', true);
  try {
    for (let item = nextWaiting(); item !== undefined && !unmounted; item = nextWaiting()) await send(item);
  } finally {
    draining = false;
    if (!unmounted) emit('busy', false);
  }
}

/** Send one file. An answer that arrives after unmount changes nothing and starts no polling. */
async function send(item: QueueItem): Promise<void> {
  item.stage = 'sending';
  try {
    const accepted = await props.api.upload(item.file, item.choice);
    if (unmounted) return;
    item.status = accepted.status;
    item.dedupe = accepted.dedupe;
    item.uploadId = accepted.upload_id;
    item.stage = 'accepted';
    byUpload.set(accepted.upload_id, [...(byUpload.get(accepted.upload_id) ?? []), item]);
    tracker.track(accepted.upload_id);
  } catch (error) {
    if (unmounted) return;
    item.problem = describeUploadError(error);
    item.stage = 'error';
  }
}

/** A tracker report, applied to every line for that upload (the same bytes handed over twice share one). */
function onChange(update: TrackedUpload): void {
  for (const item of byUpload.get(update.uploadId) ?? []) {
    item.tracked = update;
    if (update.row !== null) item.status = update.row.status;
  }
  if (update.phase === 'done' && update.row !== null) emit('settled', update.row);
}

function stateOf(item: QueueItem): RowState {
  switch (item.stage) {
    case 'waiting':
      return { tone: 'wait', headline: 'Waiting to send', detail: '' };
    case 'sending':
      return { tone: 'wait', headline: 'Sending…', detail: '' };
    case 'refused':
    case 'error':
      return { tone: 'fail', headline: 'Not sent', detail: item.problem };
    case 'accepted':
      return trackedState(item.tracked);
  }
}

/** The server's row in words, plus why the last check on it failed, if it did. */
function trackedState(tracked: TrackedUpload | null): RowState {
  const base: RowState = tracked?.row ? describeRow(tracked.row, { waitedMs: tracked.waitedMs }) : { tone: 'wait', headline: 'Sent', detail: '' };
  if (tracked === null || tracked.failure === '') return base;
  const note = tracked.phase === 'gave-up' ? tracked.failure : `Could not check on it: ${tracked.failure}`;
  return { ...base, detail: [base.detail, note].filter((part) => part !== '').join(' ') };
}

/** The dataset as chosen until the server's row arrives, then as the row records it. */
function badgeOf(item: QueueItem): string {
  const row = item.tracked?.row;
  if (!row) return DATASET_LABELS[item.choice.dataset];
  return row.dataset === null ? NO_DATASET_LABEL : DATASET_LABELS[row.dataset];
}

/** Where a landed file's hands can be seen — only when its row says which dataset they went into. */
function linkOf(item: QueueItem): { to: string; label: string } | null {
  const row = item.tracked?.row;
  return row?.status === 'completed' && row.dataset !== null ? LINKS[row.dataset] : null;
}
</script>

<template>
  <section v-if="items.length > 0" class="space-y-2" data-testid="upload-queue">
    <h2 class="font-medium">Sent from this page</h2>
    <ul class="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <li v-for="{ item, state, status, badge, link } in lines" :key="item.key" class="space-y-1 p-3" data-testid="upload-item" :data-status="status">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-mono text-xs break-all" data-testid="upload-item-name">{{ item.path }}</span>
          <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" data-testid="upload-item-dataset">{{ badge }}</span>
          <span v-if="item.stage === 'accepted' && dedupeNote(item) !== ''" class="text-xs text-zinc-500" data-testid="upload-item-dedupe">{{ dedupeNote(item) }}</span>
          <span role="status" aria-live="polite" class="text-sm" :class="TONE_CLASSES[state.tone]" data-testid="upload-item-state">{{ state.headline }}</span>
          <NuxtLink v-if="link" :to="link.to" class="ml-auto text-sm underline underline-offset-2" data-testid="upload-item-link">{{ link.label }}</NuxtLink>
        </div>
        <p
          v-if="state.detail"
          :role="state.tone === 'fail' ? 'alert' : undefined"
          class="text-sm"
          :class="state.tone === 'warn' ? 'rounded border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200' : TONE_CLASSES[state.tone]"
          data-testid="upload-item-detail"
        >
          {{ state.detail }}
        </p>
      </li>
    </ul>
  </section>
</template>
