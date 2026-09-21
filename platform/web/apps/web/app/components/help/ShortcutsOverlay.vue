<script setup lang="ts">
/**
 * The `?` overlay (spec §13: "Keyboard shortcuts, discoverable. A `?` overlay lists them").
 *
 * Built from `~/help/shortcuts` alone, so the list cannot disagree with the registry. A native
 * `<dialog>` for the same reason as `SaveReportDialog`: `showModal()` brings Esc-to-close and
 * focus trapping from the platform, and there is no work inside it to lose. It listens for `?`
 * on the window itself, so the shell only mounts it; the help menu opens it through `v-model:open`.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { Chord } from '~/help/shortcuts';
import { SHORTCUT_GROUPS, asksForShortcuts, isApplePlatform, keyLabel } from '~/help/shortcuts';

const open = defineModel<boolean>('open', { default: false });

const dialog = ref<HTMLDialogElement | null>(null);
const apple = ref(false);

function show(visible: boolean): void {
  const element = dialog.value;
  if (element === null || element.open === visible) return;
  if (visible) element.showModal();
  else element.close();
}

function onKey(event: KeyboardEvent): void {
  if (!asksForShortcuts(event)) return;
  event.preventDefault();
  open.value = !open.value;
}

/** A chord as printed on the keys: `⌘⇧Z` on a Mac, `Ctrl+Shift+Z` elsewhere. */
function chordText(chord: Chord): string {
  return chord.map((token) => keyLabel(token, apple.value)).join(apple.value ? '' : '+');
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

watch(open, show);

onMounted(() => {
  apple.value = isApplePlatform(navigator.platform);
  window.addEventListener('keydown', onKey);
  show(open.value);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <dialog
    ref="dialog"
    data-testid="shortcuts-overlay"
    aria-labelledby="shortcuts-title"
    class="m-auto w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-zinc-900/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    @close="open = false"
  >
    <div class="max-h-[80vh] space-y-4 overflow-y-auto p-4">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="shortcuts-title" class="text-lg font-semibold">Keyboard shortcuts</h2>
        <button type="button" data-testid="shortcuts-close" class="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" @click="open = false">
          Close <kbd class="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">{{ keyLabel('Escape', apple) }}</kbd>
        </button>
      </div>

      <section v-for="group in SHORTCUT_GROUPS" :key="group.title" class="space-y-1" :data-testid="`shortcuts-group-${slug(group.title)}`">
        <h3 class="font-medium">{{ group.title }}</h3>
        <p class="text-xs text-zinc-500">{{ group.where }}</p>
        <dl class="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
          <div v-for="shortcut in group.shortcuts" :key="shortcut.does" class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-1" data-testid="shortcut-row">
            <dt class="flex min-w-32 flex-wrap items-baseline gap-1">
              <template v-for="(chord, i) in shortcut.chords" :key="i">
                <span v-if="i > 0" class="text-xs text-zinc-500">or</span>
                <kbd class="rounded border border-zinc-300 bg-zinc-50 px-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900">{{ chordText(chord) }}</kbd>
              </template>
            </dt>
            <dd class="text-zinc-700 dark:text-zinc-300">{{ shortcut.does }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </dialog>
</template>
