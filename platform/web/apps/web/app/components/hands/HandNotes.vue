<script setup lang="ts">
/**
 * The note and the tags on one stored hand (plan D.7b), under the replayer.
 *
 * The API arrives as a prop, the way `poker-ui`'s components take their services, so the panel
 * mounts in a test with an in-memory fake and no Nuxt. The note autosaves after typing stops
 * (`~/hands/notes`) and says so beside the box — "Saving…", "Saved", or "Not saved:" with the
 * server's reason — and is flushed on blur and on leaving the page, so typed text is never lost
 * to navigation. Tags round-trip on every add and remove, and a chip shows the tag as the server
 * spells it: trimmed and lower-case, whatever was typed.
 *
 * Nothing here is written until the server has answered what is already there: the box stays
 * disabled while loading, so an autosave cannot overwrite a note with the empty draft.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { describeApiError } from '~/auth/api';
import type { HandNotesApi, SaveState, TagCount } from '~/hands/notes';
import { MAX_NOTE_CHARS, MAX_TAG_CHARS, createAutosave, saveStateText, tagLooksNew } from '~/hands/notes';

const props = defineProps<{ handUid: string; api: HandNotesApi }>();

const body = ref('');
const loaded = ref(false);
const loadProblem = ref('');
const saveState = ref<SaveState>('clean');
const saveFailure = ref('');
const tags = ref<string[]>([]);
const vocabulary = ref<TagCount[]>([]);
const draft = ref('');
const tagBusy = ref(false);
const tagProblem = ref('');

const autosave = createAutosave(
  async (text) => {
    await props.api.saveNote(props.handUid, text);
  },
  (error) => describeApiError(error),
  {
    onState: (state, failure) => {
      saveState.value = state;
      saveFailure.value = failure;
    },
  },
);

const status = computed(() => saveStateText(saveState.value, saveFailure.value));
const canAdd = computed(() => loaded.value && !tagBusy.value && tagLooksNew(draft.value, tags.value));
const suggestions = computed(() => vocabulary.value.filter((entry) => !tags.value.includes(entry.tag)));
const listId = computed(() => `hand-tags-${props.handUid}`);

onMounted(load);
onBeforeUnmount(() => {
  void autosave.flush();
});

async function load(): Promise<void> {
  const [note, mine, all] = await Promise.allSettled([
    props.api.note(props.handUid),
    props.api.tags(props.handUid),
    props.api.vocabulary(),
  ]);
  if (note.status === 'fulfilled') {
    body.value = note.value.body;
    loaded.value = true;
  } else loadProblem.value = describeApiError(note.reason);
  if (mine.status === 'fulfilled') tags.value = mine.value.tags;
  else tagProblem.value = describeApiError(mine.reason);
  // The vocabulary only feeds the suggestions; without it the box still works.
  if (all.status === 'fulfilled') vocabulary.value = all.value;
}

function onInput(event: Event): void {
  body.value = (event.target as HTMLTextAreaElement).value;
  autosave.change(body.value);
}

async function addTag(): Promise<void> {
  if (!canAdd.value) return;
  tagBusy.value = true;
  tagProblem.value = '';
  try {
    tags.value = (await props.api.addTag(props.handUid, draft.value)).tags;
    draft.value = '';
    // This catch stays silent on purpose (audit §2.13): the tag is already saved, and the
    // vocabulary only feeds the suggestions below the box. A failed refresh leaves the list as it
    // was rather than putting an error on a thing that worked.
    vocabulary.value = await props.api.vocabulary().catch(() => vocabulary.value);
  } catch (error) {
    tagProblem.value = describeApiError(error);
  } finally {
    tagBusy.value = false;
  }
}

async function removeTag(tag: string): Promise<void> {
  tagBusy.value = true;
  tagProblem.value = '';
  try {
    tags.value = (await props.api.removeTag(props.handUid, tag)).tags;
  } catch (error) {
    tagProblem.value = describeApiError(error);
  } finally {
    tagBusy.value = false;
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="hand-notes">
    <div class="space-y-1">
      <div class="flex flex-wrap items-baseline gap-2">
        <h2 class="font-medium">Note</h2>
        <span class="text-xs text-zinc-500" data-testid="note-status" :data-state="saveState" role="status" aria-live="polite">{{ status }}</span>
      </div>
      <textarea
        :value="body"
        rows="4"
        spellcheck="true"
        data-testid="note-body"
        aria-label="Note on this hand"
        :maxlength="MAX_NOTE_CHARS"
        :disabled="!loaded"
        placeholder="What happened here, and what to do next time."
        class="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm disabled:opacity-50 dark:border-zinc-700"
        @input="onInput"
        @blur="autosave.flush()"
      ></textarea>
      <p v-if="loadProblem" role="alert" data-testid="note-error" class="text-sm text-red-600 dark:text-red-400">{{ loadProblem }}</p>
    </div>

    <div class="space-y-2">
      <h2 class="font-medium">Tags</h2>
      <ul class="flex flex-wrap gap-2" data-testid="tag-list">
        <li
          v-for="tag in tags"
          :key="tag"
          class="flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-sm dark:border-zinc-700"
          :data-testid="`tag-chip-${tag}`"
        >
          <span>{{ tag }}</span>
          <button type="button" class="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" :aria-label="`remove ${tag}`" :data-testid="`tag-remove-${tag}`" :disabled="tagBusy" @click="removeTag(tag)">×</button>
        </li>
        <li v-if="tags.length === 0" class="text-sm text-zinc-500" data-testid="tags-empty">No tags yet.</li>
      </ul>
      <form class="flex items-center gap-2" @submit.prevent="addTag">
        <input
          v-model="draft"
          type="text"
          :maxlength="MAX_TAG_CHARS"
          :list="listId"
          data-testid="tag-input"
          aria-label="Add a tag"
          placeholder="Add a tag"
          :disabled="!loaded || tagBusy"
          class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <datalist :id="listId">
          <option v-for="entry in suggestions" :key="entry.tag" :value="entry.tag">{{ entry.hands }} hand{{ entry.hands === 1 ? '' : 's' }}</option>
        </datalist>
        <button type="submit" data-testid="tag-add" :disabled="!canAdd" class="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700">Add</button>
      </form>
      <p v-if="tagProblem" role="alert" data-testid="tag-error" class="text-sm text-red-600 dark:text-red-400">{{ tagProblem }}</p>
    </div>
  </section>
</template>
