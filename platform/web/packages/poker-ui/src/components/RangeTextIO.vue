<script setup lang="ts">
/**
 * Paste a range in either notation, copy it back in either (spec §4.3, §12). The text area
 * shows the current range serialized in the chosen format and re-parses on Apply; errors name
 * the entry and suggest a fix, warnings (weights above 1, duplicates, ambiguous plus terms)
 * show without blocking.
 */
import type { RangeFormat, WeightedRange } from '@poker/core';
import { RangeParseError, parseRange, serializeClassFormat, serializeRange } from '@poker/core';
import { computed, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ range: WeightedRange; format?: RangeFormat }>(), { format: 'class' });
const emit = defineEmits<{ 'update:range': [range: WeightedRange]; formatChange: [format: RangeFormat] }>();

const format = ref<RangeFormat>(props.format);
const text = ref('');
const error = ref<string | null>(null);
const warnings = ref<string[]>([]);
const copied = ref<string | null>(null);

const serialized = computed(() => serializeRange(props.range, format.value));
const lossy = computed(() => (format.value === 'class' ? serializeClassFormat(props.range).warnings : []));

watch([() => props.range, format], () => (text.value = serialized.value), { immediate: true });
watch(
  () => props.format,
  (f) => (format.value = f),
);

function apply(): void {
  try {
    const parsed = parseRange(text.value);
    error.value = null;
    warnings.value = parsed.warnings;
    emit('update:range', parsed.range);
  } catch (e) {
    error.value = e instanceof RangeParseError ? e.message : String(e);
  }
}

function setFormat(next: RangeFormat): void {
  format.value = next;
  emit('formatChange', next);
}

async function copy(as: RangeFormat): Promise<void> {
  const value = serializeRange(props.range, as);
  try {
    await navigator.clipboard.writeText(value);
    copied.value = as;
  } catch {
    copied.value = null;
    text.value = value;
  }
}
</script>

<template>
  <div class="pk-textio">
    <div class="pk-row">
      <label><input type="radio" value="class" :checked="format === 'class'" @change="setFormat('class')" /> class notation</label>
      <label><input type="radio" value="combo" :checked="format === 'combo'" @change="setFormat('combo')" /> combo notation</label>
    </div>
    <textarea v-model="text" class="pk-text" rows="4" spellcheck="false" aria-label="range text" @keydown.meta.enter="apply" @keydown.ctrl.enter="apply" />
    <div class="pk-row">
      <button type="button" class="pk-btn pk-primary" @click="apply">Apply (⌘↵)</button>
      <button type="button" class="pk-btn" @click="copy('combo')">Copy as combo format</button>
      <button type="button" class="pk-btn" @click="copy('class')">Copy as class format</button>
      <span v-if="copied" class="pk-muted">copied as {{ copied }} format</span>
    </div>
    <p v-if="error" class="pk-error" role="alert">{{ error }}</p>
    <ul v-if="warnings.length" class="pk-warnings">
      <li v-for="w in warnings" :key="w">{{ w }}</li>
    </ul>
    <p v-if="lossy.length" class="pk-muted">Class notation cannot keep every weight here ({{ lossy.length }} class{{ lossy.length === 1 ? '' : 'es' }} averaged); copy as combo format to keep them all.</p>
  </div>
</template>

<style scoped>
.pk-textio {
  display: grid;
  gap: 0.5rem;
  color: var(--pk-fg, #18181b);
}
.pk-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
}
.pk-text {
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #fff);
  color: inherit;
}
.pk-btn {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-surface, #f4f4f5);
  color: inherit;
  cursor: pointer;
}
.pk-primary {
  border-color: var(--pk-accent, #2563eb);
}
.pk-error {
  margin: 0;
  color: var(--pk-heart, #dc2626);
  font-size: 0.875rem;
}
.pk-warnings {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
</style>
