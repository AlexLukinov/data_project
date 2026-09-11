<script setup lang="ts">
/**
 * Show and build an action line (plan D.3), the `f·x·l·c·b·r` encoding the registry uses for
 * `preflop_line`, `street_line`, `line_so_far` and `prev_street_my_action`.
 *
 * The stored value is what the filter sends (`r/x-c/`); what is shown is the words
 * (`raise / check-call`). Building one is appending an action, not typing letters — the
 * alphabet is a convention nobody should have to memorise to ask a question.
 */
import { computed } from 'vue';

import { ACTION_LETTERS, ACTION_WORDS, formatLine, lineWords, parseLine } from '../line';

const props = withDefaults(
  defineProps<{
    line: string;
    mode?: 'view' | 'edit';
    /** Whether this dimension spans streets (`line_so_far`) or only the current one. */
    streets?: boolean;
    label?: string;
  }>(),
  { mode: 'view', streets: false, label: 'action line' },
);

const emit = defineEmits<{ 'update:line': [line: string] }>();

const parsed = computed(() => parseLine(props.line));
const words = computed(() => lineWords(props.line));

function append(letter: string): void {
  const streets = parsed.value.map((street) => [...street]);
  const last = streets[streets.length - 1] ?? [];
  if (streets.length === 0) streets.push(last);
  last.push(letter);
  emit('update:line', formatLine(streets));
}

function nextStreet(): void {
  emit('update:line', formatLine([...parsed.value.map((s) => [...s]), []]));
}

function back(): void {
  const streets = parsed.value.map((street) => [...street]);
  const last = streets[streets.length - 1];
  if (last !== undefined && last.length > 0) last.pop();
  else if (streets.length > 1) streets.pop();
  emit('update:line', formatLine(streets));
}
</script>

<template>
  <div class="pk-line" data-testid="action-line">
    <p class="pk-words" :aria-label="label" data-testid="action-line-words">{{ words }}</p>
    <div v-if="mode === 'edit'" class="pk-controls">
      <div class="pk-chips">
        <template v-for="(street, s) in parsed" :key="s">
          <span v-if="s > 0" class="pk-slash" aria-hidden="true">/</span>
          <span v-for="(letter, i) in street" :key="`${s}-${i}`" class="pk-chip">{{ ACTION_WORDS[letter] ?? letter }}</span>
          <span v-if="street.length === 0" class="pk-empty">—</span>
        </template>
      </div>
      <div class="pk-buttons">
        <button
          v-for="letter in ACTION_LETTERS"
          :key="letter"
          type="button"
          class="pk-btn"
          :data-testid="`action-add-${letter}`"
          @click="append(letter)"
        >
          {{ ACTION_WORDS[letter] }}
        </button>
        <button v-if="streets" type="button" class="pk-btn pk-sep" data-testid="action-next-street" @click="nextStreet">next street</button>
        <button type="button" class="pk-btn pk-sep" data-testid="action-back" @click="back">undo</button>
        <button type="button" class="pk-btn pk-sep" data-testid="action-clear" @click="emit('update:line', '')">clear</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pk-line {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pk-words {
  margin: 0;
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}

.pk-controls {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pk-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem;
  min-height: 1.5rem;
}

.pk-chip {
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.3rem;
  background: var(--pk-surface, #f4f4f5);
  font-size: 0.75rem;
}

.pk-slash,
.pk-empty {
  color: var(--pk-muted, #71717a);
  font-size: 0.75rem;
}

.pk-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.pk-btn {
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 0.3rem;
  background: var(--pk-bg, #ffffff);
  color: var(--pk-fg, #18181b);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.pk-btn:hover {
  border-color: var(--pk-accent, #2563eb);
}

.pk-sep {
  color: var(--pk-muted, #71717a);
}

.pk-btn:focus-visible {
  outline: 2px solid var(--pk-accent, #2563eb);
  outline-offset: 1px;
}
</style>
