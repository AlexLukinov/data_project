<script setup lang="ts">
/**
 * How thin a cell has to be before the grid dims it — behind the "Advanced" fold spec §13 asks
 * for (plan F.12).
 *
 * **Why this one control and not the pickers beside it.** §13's line is "advanced controls behind
 * a clearly-labelled Advanced disclosure, with defaults that work untouched", and this is the only
 * control on `/reports` or `/pool` that answers to every word of it. It never reaches the server:
 * `reports/model.ts#request` sends `stats`, `group_by`, the situation and `compare_to`, and no
 * `min_n` — the threshold is applied in the browser by `reports/cell.ts#cellView`, so changing it
 * re-reads an answer and never re-asks a question. Its default is `MIN_N`, the same hundred the
 * leak finder and the pool's node query use, and the tool catalogue puts it *after* the run:
 * "Run it, **then** raise the reading threshold…" (`help/tools/pool.ts`). The stat picker and the
 * group-by, by contrast, are the screen's advertised job — folding those would hide the job rather
 * than disclose it progressively.
 *
 * **The threshold in use is printed on the summary**, so the fold can stay closed without hiding
 * what it is doing — the rule `PotOddsPanel` already follows for the rake it folds.
 *
 * One component for both screens: `/reports` reached the same `<select>` through `ReadingOptions`
 * and `/pool` rendered its own copy as a bare `<label>` under no heading at all, which is how the
 * two drifted into two spellings of one control.
 */
import { MIN_N_CHOICES } from '~/reports/cell';

const minN = defineModel<number>({ required: true });
</script>

<template>
  <details class="text-sm" data-testid="reading-threshold">
    <summary class="cursor-pointer text-zinc-500">
      Advanced: {{ minN === 0 ? 'every cell is shown undimmed, whatever its sample' : `cells under ${minN} observations are dimmed` }}
    </summary>
    <label class="mt-2 flex items-center gap-2">
      <span class="text-zinc-500">grey a cell under</span>
      <select v-model.number="minN" data-testid="minn-select" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700">
        <option v-for="choice in MIN_N_CHOICES" :key="choice" :value="choice">{{ choice === 0 ? 'never — show every number' : `${choice} observations` }}</option>
      </select>
    </label>
  </details>
</template>
