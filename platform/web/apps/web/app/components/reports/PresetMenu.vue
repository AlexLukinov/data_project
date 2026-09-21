<script setup lang="ts">
/**
 * The reports you can open: the standard ones, and your own (plan D.5).
 *
 * They are one list because they are one kind of thing. A preset's `request` and a saved report's
 * `definition` are both a `ReportRequest` — the same document `POST /v1/reports/run` takes — so a
 * preset is the platform's idea of a standard report and a saved report is the founder's, and
 * opening either is the same code path. Nothing here is authored in the client: the standard
 * reports are `analysis/{hero,pool}/presets.yaml`, validated against the registry when the module
 * loads.
 */
import { byModule } from '~/reports/library';
import type { ModulePreset } from '~/reports/library';
import type { SavedReport } from '~/reports/api';
import PresetButton from './PresetButton.vue';

const props = defineProps<{
  presets: readonly ModulePreset[];
  saved: readonly SavedReport[];
  /** The saved report currently open, so the list can say which one you are looking at. */
  openId: string | null;
  busy: boolean;
  /**
   * Whether the library failed to load. An empty list then means "not read", not "none saved",
   * and "None yet. Build a report and save it" would be telling someone their own reports are
   * gone. The page's own `library-error` says what happened; this line just gets out of the way.
   */
  failed: boolean;
}>();

const emit = defineEmits<{
  openPreset: [preset: ModulePreset];
  openSaved: [report: SavedReport];
  remove: [report: SavedReport];
}>();
</script>

<template>
  <section class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="report-library">
    <div v-for="group in byModule(props.presets)" :key="group.module" class="space-y-1">
      <p class="text-xs text-zinc-500">Standard reports — {{ group.label }}</p>
      <div class="flex flex-wrap gap-1">
        <PresetButton v-for="preset in group.presets" :key="preset.code" :preset="preset" :disabled="props.busy" :testid="`preset-${preset.code}`" @open="emit('openPreset', preset)" />
      </div>
    </div>

    <div class="space-y-1">
      <p class="text-xs text-zinc-500">My saved reports</p>
      <ul v-if="props.saved.length" class="flex flex-wrap gap-1" data-testid="library-saved">
        <li
          v-for="report in props.saved"
          :key="report.id"
          class="flex items-center rounded border"
          :class="report.id === props.openId ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-300 dark:border-zinc-700'"
        >
          <button
            type="button"
            :disabled="props.busy"
            :title="`${report.module === 'hero' ? 'My game' : 'The pool'} · saved ${report.created_at.slice(0, 10)}`"
            :data-testid="`saved-${report.id}`"
            class="px-2 py-0.5 text-xs disabled:opacity-40"
            :class="report.id === props.openId ? 'font-medium' : ''"
            @click="emit('openSaved', report)"
          >
            {{ report.name }}
          </button>
          <button
            type="button"
            :aria-label="`delete ${report.name}`"
            :data-testid="`delete-${report.id}`"
            class="border-l border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            @click="emit('remove', report)"
          >
            ×
          </button>
        </li>
      </ul>
      <p v-else-if="!props.failed" class="text-sm text-zinc-500" data-testid="library-empty">
        None yet. Build a report and save it — it reopens from its own link.
      </p>
    </div>
  </section>
</template>
