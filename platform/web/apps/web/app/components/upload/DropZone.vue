<script setup lang="ts">
/**
 * Where hand-history files come in (plan D.8): a drop area that also takes a whole folder, and
 * two pickers for when dragging is awkward — files, or a folder. Folders are walked the way the
 * range import walks them (`~/ranges/files`), hidden files skipped, so a dropped export directory
 * becomes its files with their paths.
 *
 * It only hands the files on; what may be sent, and how, is the queue's business. Walking a big
 * folder takes a moment, and the files are handed on only at the end of it, so `reading` says when
 * that starts and stops — the page locks the dataset for the duration, or a switch made meanwhile
 * would send the whole folder under the other one. A second drop while reading is ignored.
 */
import { ref } from 'vue';

import type { PathedFile } from '~/ranges/files';
import { UNREADABLE_DROP, collectEntries, entriesOf, pickedFiles } from '~/ranges/files';

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ files: [files: PathedFile[]]; reading: [reading: boolean] }>();

const reading = ref(false);
const problem = ref('');

async function onDrop(event: DragEvent): Promise<void> {
  if (props.disabled || reading.value || event.dataTransfer === null) return;
  setReading(true);
  problem.value = '';
  try {
    const files = await collectEntries(entriesOf(event.dataTransfer));
    if (files.length > 0) emit('files', files);
  } catch {
    problem.value = UNREADABLE_DROP;
  } finally {
    setReading(false);
  }
}

function setReading(value: boolean): void {
  reading.value = value;
  emit('reading', value);
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files !== null && input.files.length > 0) {
    // The unreadable-drop sentence sends the reader to these very links, so a pick that worked has
    // to take it down; leaving it up reads as the pick having failed too.
    problem.value = '';
    emit('files', pickedFiles(input.files));
  }
  // Cleared so choosing the same file again is a change again.
  input.value = '';
}
</script>

<template>
  <div
    class="rounded-lg border-2 border-dashed border-zinc-300 p-6 text-center text-sm dark:border-zinc-700"
    :class="{ 'opacity-50': disabled }"
    :aria-disabled="disabled ? 'true' : undefined"
    data-testid="upload-drop"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <p>Drop hand-history files or a folder here</p>
    <p class="mt-2 text-zinc-500">
      or choose
      <label class="cursor-pointer underline">files<input type="file" class="sr-only" multiple :disabled="disabled" data-testid="upload-files-input" @change="onPick" /></label>
      ·
      <label class="cursor-pointer underline">a folder<input type="file" class="sr-only" multiple webkitdirectory :disabled="disabled" data-testid="upload-folder-input" @change="onPick" /></label>
    </p>
    <p v-if="reading" role="status" aria-live="polite" class="mt-2 text-sm text-zinc-500" data-testid="upload-drop-reading">Reading the folder…</p>
    <p v-if="problem" role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400" data-testid="upload-drop-error">{{ problem }}</p>
  </div>
</template>
