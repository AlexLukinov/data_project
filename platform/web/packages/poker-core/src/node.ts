/**
 * `NodeKey` — one situation (spec §10.1, ADR-028). `analysis/pool/nodes.py` is the definition;
 * this is its twin with the same field names on the wire, and `tests/fixtures/nodes.json` is
 * parsed by both test suites so the two cannot drift.
 *
 * The action sequence ends with hero's own action: a range stored at a node is "the combos that
 * take the last step". `UTG RFI` is `[UTG raise]`; `BB defend vs CO 2.5x` is
 * `[CO raise 2.5, BB call]`. The pool reads the same key with the last step removed (F.8).
 */

export const POSITIONS = ['UTG', 'UTG1', 'UTG2', 'MP', 'MP1', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof POSITIONS)[number];
export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export type Street = (typeof STREETS)[number];
export const NODE_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'limp', 'allin'] as const;
export type NodeAction = (typeof NODE_ACTIONS)[number];

export interface ActionStep {
  readonly position: Position;
  readonly action: NodeAction;
  /** A preflop raise-to, in big blinds. */
  readonly size_bb: number | null;
  /** A postflop bet or raise as a fraction of the pot. */
  readonly size_pct: number | null;
}

export interface NodeKey {
  readonly stake: string;
  readonly table_size: number;
  readonly eff_stack_bb: number;
  readonly hero_position: Position;
  readonly villain_position: Position | null;
  readonly action_sequence: readonly ActionStep[];
  readonly street: Street;
  readonly board_texture: readonly string[];
}

export const DEFAULT_TABLE_SIZE = 6;
export const DEFAULT_STACK_BB = 100;
const MIN_TABLE_SIZE = 2;
const MAX_TABLE_SIZE = 10;
const MAX_STACK_BB = 10_000;
const MAX_STAKE_CHARS = 16;
const MAX_SEQUENCE = 24;
const MAX_TEXTURE_TAGS = 8;
const MAX_TAG_CHARS = 32;
const KEY_FIELDS = ['stake', 'table_size', 'eff_stack_bb', 'hero_position', 'villain_position', 'action_sequence', 'street', 'board_texture'] as const;
const STEP_FIELDS = ['position', 'action', 'size_bb', 'size_pct'] as const;

/** A key that does not validate: the path of the field and what is wrong with it. */
export class NodeKeyError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'NodeKeyError';
  }
}

/** One step; sizes default to none. */
export function step(position: Position, action: NodeAction, sizes: { size_bb?: number; size_pct?: number } = {}): ActionStep {
  return { position, action, size_bb: sizes.size_bb ?? null, size_pct: sizes.size_pct ?? null };
}

/** A key with every default filled in. */
export function nodeKey(hero_position: Position, rest: Partial<Omit<NodeKey, 'hero_position'>> = {}): NodeKey {
  return {
    stake: rest.stake ?? '',
    table_size: rest.table_size ?? DEFAULT_TABLE_SIZE,
    eff_stack_bb: rest.eff_stack_bb ?? DEFAULT_STACK_BB,
    hero_position,
    villain_position: rest.villain_position ?? null,
    action_sequence: rest.action_sequence ?? [],
    street: rest.street ?? 'preflop',
    board_texture: rest.board_texture ?? [],
  };
}

type Plain = Record<string, unknown>;

function object(value: unknown, path: string, fields: readonly string[]): Plain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new NodeKeyError(path, 'must be an object');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new NodeKeyError(`${path}.${key}`, 'unknown field');
  return value as Plain;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new NodeKeyError(path, `must be one of ${allowed.join(', ')}`);
  return value as T;
}

function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new NodeKeyError(path, `must be an integer from ${min} to ${max}`);
  return value;
}

function positiveOrNull(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new NodeKeyError(path, 'must be a positive number');
  return value;
}

function text(value: unknown, max: number, path: string): string {
  if (typeof value !== 'string' || value.length > max) throw new NodeKeyError(path, `must be a string of at most ${max} characters`);
  return value;
}

function list(value: unknown, max: number, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new NodeKeyError(path, `must be a list of at most ${max} entries`);
  return value;
}

function parseStep(value: unknown, path: string): ActionStep {
  const o = object(value, path, STEP_FIELDS);
  return {
    position: oneOf(o.position, POSITIONS, `${path}.position`),
    action: oneOf(o.action, NODE_ACTIONS, `${path}.action`),
    size_bb: positiveOrNull(o.size_bb, `${path}.size_bb`),
    size_pct: positiveOrNull(o.size_pct, `${path}.size_pct`),
  };
}

function parseTag(value: unknown, path: string): string {
  const tag = text(value, MAX_TAG_CHARS, path);
  if (tag === '') throw new NodeKeyError(path, 'must not be empty');
  return tag;
}

/** Validate a plain object (an API response, a JSON file) into a key; throws `NodeKeyError` naming the field. */
export function parseNodeKey(value: unknown, path = 'node'): NodeKey {
  const o = object(value, path, KEY_FIELDS);
  return {
    stake: o.stake === undefined ? '' : text(o.stake, MAX_STAKE_CHARS, `${path}.stake`),
    table_size: o.table_size === undefined ? DEFAULT_TABLE_SIZE : integer(o.table_size, MIN_TABLE_SIZE, MAX_TABLE_SIZE, `${path}.table_size`),
    eff_stack_bb: o.eff_stack_bb === undefined ? DEFAULT_STACK_BB : integer(o.eff_stack_bb, 1, MAX_STACK_BB, `${path}.eff_stack_bb`),
    hero_position: oneOf(o.hero_position, POSITIONS, `${path}.hero_position`),
    villain_position: o.villain_position === undefined || o.villain_position === null ? null : oneOf(o.villain_position, POSITIONS, `${path}.villain_position`),
    action_sequence: list(o.action_sequence, MAX_SEQUENCE, `${path}.action_sequence`).map((s, i) => parseStep(s, `${path}.action_sequence[${i}]`)),
    street: o.street === undefined ? 'preflop' : oneOf(o.street, STREETS, `${path}.street`),
    board_texture: list(o.board_texture, MAX_TEXTURE_TAGS, `${path}.board_texture`).map((t, i) => parseTag(t, `${path}.board_texture[${i}]`)),
  };
}

/** The key as a plain JSON object in the canonical field order — what the API stores and compares. */
export function nodeKeyJson(key: NodeKey): Record<string, unknown> {
  return {
    stake: key.stake,
    table_size: key.table_size,
    eff_stack_bb: key.eff_stack_bb,
    hero_position: key.hero_position,
    villain_position: key.villain_position,
    action_sequence: key.action_sequence.map((s) => ({ position: s.position, action: s.action, size_bb: s.size_bb, size_pct: s.size_pct })),
    street: key.street,
    board_texture: [...key.board_texture],
  };
}

/** One string per situation, equal exactly when two keys are the same situation. */
export function canonicalNodeKey(key: NodeKey): string {
  return JSON.stringify(nodeKeyJson(key));
}

export function nodeKeyEquals(a: NodeKey, b: NodeKey): boolean {
  return canonicalNodeKey(a) === canonicalNodeKey(b);
}

const RAISE_NAMES = ['RFI', '3-bet', '4-bet', '5-bet'];
const PERCENT = 100;

/** Hero's last action as a player would say it: RFI / 3-bet / call / shove … */
function heroVerb(key: NodeKey, last: ActionStep): string {
  if (last.action === 'raise' && key.street === 'preflop') {
    const before = key.action_sequence.slice(0, -1);
    const raises = before.filter((s) => s.action === 'raise' || s.action === 'allin').length;
    if (raises === 0 && before.some((s) => s.action === 'limp')) return 'iso';
    return RAISE_NAMES[raises] ?? `${raises + 2}-bet`;
  }
  return last.action === 'allin' ? 'shove' : last.action;
}

/** The size hero is facing: villain's most recent step before hero's last one. */
function facedSize(key: NodeKey, villain: Position): string {
  const steps = key.action_sequence.slice(0, -1);
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.position !== villain) continue;
    if (key.street === 'preflop' && s.size_bb !== null) return ` ${s.size_bb}bb`;
    if (key.street !== 'preflop' && s.size_pct !== null) return ` ${Math.round(s.size_pct * PERCENT)}%`;
    return '';
  }
  return '';
}

/** `UTG RFI · 100bb`, `BB call vs CO 2.5bb · 40bb · NL5`, `BB raise vs CO 33% · flop · 100bb`. */
export function nodeKeyLabel(key: NodeKey): string {
  const last = key.action_sequence.at(-1);
  const villain = key.villain_position ?? [...key.action_sequence].reverse().find((s) => s.position !== key.hero_position)?.position ?? null;
  const verb = last !== undefined && last.position === key.hero_position ? heroVerb(key, last) : 'to act';
  const parts = [`${key.hero_position} ${verb}${villain === null ? '' : ` vs ${villain}${facedSize(key, villain)}`}`];
  if (key.street !== 'preflop') parts.push(key.street);
  parts.push(`${key.eff_stack_bb}bb`);
  if (key.stake !== '') parts.push(key.stake);
  return parts.join(' · ');
}
