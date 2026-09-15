<script setup lang="ts">
/**
 * Uploading hand histories (plan D.8): say what the files are, drop them, watch each one land, and
 * name your seats.
 *
 * The dataset is the choice that matters: **My hands** feed My game through the seat recognised as
 * yours, **Pool hands** put every seat into the pool, and a file belongs to one of them for good —
 * the server refuses the same bytes under the other with a 409. So the dataset and the site are
 * locked from the moment a dropped folder starts being read until its last file is sent, and each
 * file in the queue shows the dataset it was sent as.
 *
 * The queue sends and follows this visit's files; the table under it is the server's list of recent
 * uploads, read again whenever a file in the queue settles.
 */
import { computed, ref } from 'vue';

import DropZone from '~/components/upload/DropZone.vue';
import PokerAccounts from '~/components/upload/PokerAccounts.vue';
import UploadList from '~/components/upload/UploadList.vue';
import UploadQueue from '~/components/upload/UploadQueue.vue';
import { describeApiError } from '~/auth/api';
import type { PathedFile } from '~/ranges/files';
import type { Dataset } from '~/upload/api';
import { RECENT_UPLOADS, createUploadsApi } from '~/upload/api';
import { DATASET_LABELS } from '~/upload/status';

const DATASETS: readonly { value: Dataset; line: string }[] = [
  { value: 'hero', line: 'your own play; My game counts your seat' },
  { value: 'population', line: 'tables you observed; every seat goes into the pool' },
];

const api = createUploadsApi(useApi());
const dataset = ref<Dataset>('hero');
const site = ref('');
const sending = ref(false);
const reading = ref(false);
/** A folder being walked is about to be sent under the choice on screen, so it counts as sending. */
const locked = computed(() => sending.value || reading.value);
const queue = ref<InstanceType<typeof UploadQueue> | null>(null);

const { data: sites, error: sitesError } = await useAsyncData('upload-sites', () => api.sites(), { server: false, default: () => [] });
const {
  data: uploads,
  error: uploadsError,
  status: uploadsStatus,
  refresh: refreshUploads,
} = await useAsyncData('uploads-recent', () => api.list(RECENT_UPLOADS), { server: false, default: () => [] });

/**
 * `useAsyncData` wraps what threw in an error of its own, which reads as a 500 even when nothing
 * answered; the sentence is about what actually threw.
 */
function reason(error: { cause?: unknown } | null | undefined): string {
  return describeApiError(error?.cause ?? error);
}

function onFiles(files: PathedFile[]): void {
  queue.value?.add(files);
}
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Upload hand histories</h1>
      <p class="text-sm text-zinc-500">Drop the .txt hand histories your poker site exports; each file is read in the background and its hands join My game or the pool once it lands.</p>
    </div>

    <div class="flex flex-wrap items-start gap-x-10 gap-y-4">
      <fieldset class="space-y-1">
        <legend class="mb-1 text-sm font-medium">These files are</legend>
        <label v-for="option in DATASETS" :key="option.value" class="flex items-baseline gap-2 text-sm">
          <input v-model="dataset" type="radio" name="upload-dataset" :value="option.value" :disabled="locked" :data-testid="`upload-dataset-${option.value}`" />
          <span>
            <span class="font-medium">{{ DATASET_LABELS[option.value] }}</span>
            <span class="text-zinc-500"> — {{ option.line }}</span>
          </span>
        </label>
      </fieldset>

      <label class="space-y-1 text-sm">
        <span class="block font-medium">Site</span>
        <select v-model="site" :disabled="locked" data-testid="upload-site" class="rounded border border-zinc-300 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-zinc-700">
          <option value="">Detect from the file</option>
          <option v-for="choice in sites" :key="choice" :value="choice">{{ choice }}</option>
        </select>
      </label>
    </div>

    <p v-if="locked" role="status" aria-live="polite" class="text-sm text-zinc-500" data-testid="upload-locked">The dataset and the site stay as they are until these files are sent.</p>
    <p v-if="sitesError" role="alert" data-testid="upload-sites-error" class="text-sm text-red-600 dark:text-red-400">
      Could not load the list of sites, so each file's site will be detected: {{ reason(sitesError) }}
    </p>

    <DropZone :disabled="locked" @files="onFiles" @reading="reading = $event" />
    <UploadQueue ref="queue" :api="api" :choice="{ site, dataset }" @busy="sending = $event" @settled="refreshUploads()" />

    <section class="space-y-2">
      <h2 class="font-medium">Recent uploads</h2>
      <p v-if="uploadsError" role="alert" data-testid="uploads-error" class="text-sm text-red-600 dark:text-red-400">Could not load your recent uploads: {{ reason(uploadsError) }}</p>
      <p v-else-if="uploadsStatus === 'pending' && uploads.length === 0" class="text-sm text-zinc-500" data-testid="uploads-loading">Loading your recent uploads…</p>
      <UploadList v-else :rows="uploads" />
    </section>

    <PokerAccounts :api="api" :sites="sites" />
  </section>
</template>
