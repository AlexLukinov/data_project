<script setup lang="ts">
/**
 * Edit a situation (spec §10.1 `NodeKey`): seats, street, stack, stake, texture and the action
 * sequence step by step. The label above the form is what the library shows, so the reader sees
 * what the key means while changing it. `v-model` of a `NodeKey`; every change emits a new key.
 */
import type { ActionStep, NodeAction, NodeKey, Position, Street } from '@poker/core';
import { NODE_ACTIONS, POSITIONS, STREETS, nodeKeyLabel, step } from '@poker/core';

const model = defineModel<NodeKey>({ required: true });

const PERCENT = 100;

function patch(change: Partial<NodeKey>): void {
  model.value = { ...model.value, ...change };
}

function number(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function text(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function setStack(event: Event): void {
  const value = number(event);
  if (value !== null && value >= 1) patch({ eff_stack_bb: Math.round(value) });
}

function setTable(event: Event): void {
  const value = number(event);
  if (value !== null && value >= 2) patch({ table_size: Math.round(value) });
}

function setTexture(event: Event): void {
  patch({ board_texture: text(event).split(',').map((t) => t.trim()).filter((t) => t !== '') });
}

function setStep(i: number, change: Partial<ActionStep>): void {
  const steps = model.value.action_sequence.map((s, j) => (j === i ? { ...s, ...change } : s));
  patch({ action_sequence: steps });
}

function setStepSize(i: number, event: Event, field: 'size_bb' | 'size_pct'): void {
  const value = number(event);
  const size = value === null || value <= 0 ? null : field === 'size_pct' ? value / PERCENT : value;
  setStep(i, { [field]: size });
}

function removeStep(i: number): void {
  patch({ action_sequence: model.value.action_sequence.filter((_, j) => j !== i) });
}

/** A new step by hero; the range is the combos that take the last step. */
function addStep(): void {
  patch({ action_sequence: [...model.value.action_sequence, step(model.value.hero_position, 'raise')] });
}
</script>

<template>
  <div class="pk-node">
    <p class="pk-node-label" data-testid="node-label">{{ nodeKeyLabel(model) }}</p>
    <div class="pk-node-grid">
      <label>hero
        <select :value="model.hero_position" data-testid="node-hero" @change="patch({ hero_position: text($event) as Position })">
          <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label>villain
        <select :value="model.villain_position ?? ''" data-testid="node-villain" @change="patch({ villain_position: text($event) === '' ? null : (text($event) as Position) })">
          <option value="">—</option>
          <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label>street
        <select :value="model.street" data-testid="node-street" @change="patch({ street: text($event) as Street })">
          <option v-for="s in STREETS" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label>stack, bb
        <input type="number" min="1" step="1" :value="model.eff_stack_bb" data-testid="node-stack" @change="setStack" />
      </label>
      <label>table
        <input type="number" min="2" max="10" step="1" :value="model.table_size" data-testid="node-table" @change="setTable" />
      </label>
      <label>stake
        <input type="text" maxlength="16" :value="model.stake" placeholder="NL5" data-testid="node-stake" @change="patch({ stake: text($event).trim() })" />
      </label>
      <label class="pk-wide">texture
        <input type="text" :value="model.board_texture.join(', ')" placeholder="rainbow, unpaired" data-testid="node-texture" @change="setTexture" />
      </label>
    </div>
    <ol class="pk-steps">
      <li v-for="(s, i) in model.action_sequence" :key="i" :data-testid="`node-step-${i}`">
        <select :value="s.position" aria-label="seat" @change="setStep(i, { position: text($event) as Position })">
          <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
        </select>
        <select :value="s.action" aria-label="action" @change="setStep(i, { action: text($event) as NodeAction })">
          <option v-for="a in NODE_ACTIONS" :key="a" :value="a">{{ a }}</option>
        </select>
        <input type="number" min="0" step="any" :value="s.size_bb ?? ''" placeholder="bb" aria-label="raise to, bb" @change="setStepSize(i, $event, 'size_bb')" />
        <input type="number" min="0" step="any" :value="s.size_pct === null ? '' : Math.round(s.size_pct * PERCENT)" placeholder="% pot" aria-label="bet, % of pot" @change="setStepSize(i, $event, 'size_pct')" />
        <button type="button" aria-label="remove step" @click="removeStep(i)">×</button>
      </li>
    </ol>
    <div class="pk-node-foot">
      <button type="button" data-testid="node-add-step" @click="addStep">Add step</button>
      <span class="pk-muted">The last step is hero's own action: the range is the combos that take it.</span>
    </div>
  </div>
</template>

<style scoped>
.pk-node {
  display: grid;
  gap: 0.6rem;
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}
.pk-node-label {
  margin: 0;
  font-weight: 600;
  font-size: 1rem;
}
.pk-node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.5rem;
}
.pk-node-grid label,
.pk-steps li {
  display: grid;
  gap: 0.2rem;
  color: var(--pk-muted, #71717a);
}
.pk-wide {
  grid-column: 1 / -1;
}
.pk-steps {
  margin: 0;
  padding-left: 1.4rem;
  display: grid;
  gap: 0.3rem;
}
.pk-steps li {
  grid-template-columns: auto auto 5rem 5rem auto;
  align-items: center;
  gap: 0.4rem;
}
select,
input {
  font: inherit;
  padding: 0.15rem 0.3rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #ffffff);
  color: var(--pk-fg, #18181b);
}
button {
  font: inherit;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #ffffff);
  color: var(--pk-fg, #18181b);
  cursor: pointer;
}
.pk-node-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.pk-muted {
  color: var(--pk-muted, #71717a);
  font-size: 0.75rem;
}
</style>
