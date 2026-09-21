<script setup lang="ts">
/**
 * A situation's shorthand with its meaning one hover away (ADR-056, audit §3.2): the label reads
 * exactly as `nodeKeyLabel` prints it — `BB call vs CO 2.5bb · 40bb · NL5` — and its tooltip
 * takes the label apart, one line per word, so "CO", "3-bet" or "40bb" is never left for the
 * reader to decode.
 */
import type { NodeKey } from '@poker/core';
import { nodeKeyLabel } from '@poker/core';
import { computed } from 'vue';

import type { NodeLabelPart } from '../nodeWords';
import { NODE_SHORTHAND, nodeLabelParts, partWord } from '../nodeWords';
import TermLabel from './TermLabel.vue';

const props = defineProps<{ node: NodeKey }>();

/**
 * The pieces, or none at all. `nodeLabelParts` throws on a shorthand it cannot take apart — which
 * is what its tests want of it — but a situation is often the only thing on a row, and a tooltip
 * is never worth a page that fails to render: an unknown shape falls back to the plain label.
 */
const parts = computed<readonly NodeLabelPart[]>(() => {
  try {
    return nodeLabelParts(props.node);
  } catch {
    return [];
  }
});
const text = computed(() => (parts.value.length === 0 ? nodeKeyLabel(props.node) : parts.value.map((part) => part.text).join('')));
</script>

<template>
  <span v-if="parts.length === 0" data-testid="node-label-plain">{{ text }}</span>
  <TermLabel v-else :entry="NODE_SHORTHAND" :label="text" name="node">
    <template #tip>
      <strong>{{ text }}</strong>
      <span v-for="(part, i) in parts" :key="i" class="pk-part" data-testid="node-label-part"><b>{{ partWord(part) }}</b> — {{ part.entry.definition }}</span>
    </template>
  </TermLabel>
</template>

<style scoped>
.pk-part {
  display: block;
  margin-top: 0.2rem;
}
.pk-part b {
  font-weight: 600;
}
</style>
