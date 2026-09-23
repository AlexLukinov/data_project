/**
 * `NodeKey` — one situation (spec §10.1, ADR-028, ADR-078). `analysis/pool/nodes.py` is the
 * definition; this is its twin with the same field names on the wire, and
 * `tests/fixtures/nodes.json` is parsed by both test suites so the two cannot drift.
 *
 * The action sequence ends with hero's own action: a range stored at a node is "the combos that
 * take the last step". `UTG RFI` is `[UTG raise]`; `BB defend vs CO 2.5x` is
 * `[CO raise 2.5, BB call]`. The pool reads the same key with the last step removed (F.8).
 *
 * The sequence carries **this street only** (the `hand/node.ts` convention). The earlier streets
 * are `line_so_far`: hero's own actions street by street in the registry's line alphabet
 * (`'r/b/b/'`: opened, bet the flop, bet the turn, deciding on the river). Its last segment is
 * this street's own actions so far, which the sequence already says, so the two must agree — a
 * key never carries two accounts of one street. `size_bucket` names the registry bucket the bet
 * in front of hero falls in, and `pot_type` how the pot was built preflop.
 */

export const POSITIONS = ['UTG', 'UTG1', 'UTG2', 'MP', 'MP1', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof POSITIONS)[number];
export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export type Street = (typeof STREETS)[number];
export const NODE_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'limp', 'allin'] as const;
export type NodeAction = (typeof NODE_ACTIONS)[number];
/** The registry's `pot_type` values; the shared fixture pins them to `POT_TYPES` in nodes.py. */
export const POT_TYPES = ['limped', 'srp', '3bet', '4bet', '5bet_plus'] as const;
export type PotType = (typeof POT_TYPES)[number];
/** The registry's `facing_size_pct` bucket names. Only the names live here: the boundaries are the registry's (ADR-028). */
export const SIZE_BUCKETS = ['small', 'mid', 'large', 'pot', 'overbet'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
/** The line alphabet of `dimensions.yaml` (`LETTER` in nodes.py); an all-in is a raise as far as a line is concerned. */
export const LINE_LETTERS: Readonly<Record<NodeAction, string>> = { fold: 'f', check: 'x', limp: 'l', call: 'c', bet: 'b', raise: 'r', allin: 'r' };
/** Streets of a line are joined by this; the actions within one by `-`. */
export const LINE_STREET_SEP = '/';
/** A dimension's buckets as `/v1/definitions` gives them (`Dimension.buckets`): a null low is 0, a null high is open. */
export type BucketRanges = Readonly<Record<string, readonly [number | null, number | null]>>;

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
  /** Hero's own line across streets, `'r/x-c/'` style: one segment per street up to this one. */
  readonly line_so_far: string | null;
  /** The registry bucket of the bet hero is facing, as a fraction of the pot; postflop only. */
  readonly size_bucket: SizeBucket | null;
  readonly pot_type: PotType | null;
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
const MAX_LINE_CHARS = 64;
const LINE_ACTION_SEP = '-';
/** Letters joined by `-` within a street, streets joined by `/`; `''` and `'r/'` both fit. */
const LINE_PATTERN = /^(?:[fxlcbr](?:-[fxlcbr])*)?(?:\/(?:[fxlcbr](?:-[fxlcbr])*)?)*$/;
const KEY_FIELDS = ['stake', 'table_size', 'eff_stack_bb', 'hero_position', 'villain_position', 'action_sequence', 'street', 'line_so_far', 'size_bucket', 'pot_type', 'board_texture'] as const;
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

/** Hero's own actions among `steps` in the line alphabet (`own_line` in nodes.py): `'x-c'`. */
export function ownLine(steps: readonly ActionStep[], hero: Position): string {
  return steps.filter((s) => s.position === hero).map((s) => LINE_LETTERS[s.action]).join(LINE_ACTION_SEP);
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
    line_so_far: rest.line_so_far ?? null,
    size_bucket: rest.size_bucket ?? null,
    pot_type: rest.pot_type ?? null,
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

function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[], path: string): T | null {
  return value === undefined || value === null ? null : oneOf(value, allowed, path);
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

function lineOrNull(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  const line = text(value, MAX_LINE_CHARS, path);
  if (!LINE_PATTERN.test(line)) throw new NodeKeyError(path, `must be letters f/x/l/c/b/r joined by '${LINE_ACTION_SEP}' within a street and '${LINE_STREET_SEP}' between streets`);
  return line;
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

/**
 * `line_so_far` is postflop, reaches exactly this street and ends the way the sequence says
 * (`_one_account_of_this_street` in nodes.py). Preflop the sequence is the whole line, so a line
 * there would be a second spelling of one situation (`''` beside `null`), and lookup compares
 * spellings (ADR-031).
 */
function checkOneAccountOfThisStreet(key: NodeKey, path: string): void {
  if (key.line_so_far === null) return;
  if (key.street === 'preflop') throw new NodeKeyError(path, "is postflop only: a preflop key's sequence is its whole line");
  const streets = key.line_so_far.split(LINE_STREET_SEP).length - 1;
  const wanted = STREETS.indexOf(key.street);
  if (streets !== wanted) throw new NodeKeyError(path, `'${key.line_so_far}' has ${streets + 1} street(s) but the key is on the ${key.street} (needs ${wanted + 1})`);
  const thisStreet = key.line_so_far.slice(key.line_so_far.lastIndexOf(LINE_STREET_SEP) + 1);
  const fromSequence = ownLine(key.action_sequence.slice(0, -1), key.hero_position);
  if (thisStreet !== fromSequence) throw new NodeKeyError(path, `ends in '${thisStreet}' but the sequence says hero's line this street is '${fromSequence}'; a key carries one account of a street`);
}

/** A preflop size is a raise-to in blinds on the step; a share of the pot is postflop only (`_a_size_bucket_is_postflop` in nodes.py). */
function checkSizeBucketIsPostflop(key: NodeKey, path: string): void {
  if (key.size_bucket !== null && key.street === 'preflop') throw new NodeKeyError(path, 'is a fraction of the pot and postflop only; a preflop size is a raise-to in big blinds on the step (size_bb)');
}

/** Validate a plain object (an API response, a JSON file) into a key; throws `NodeKeyError` naming the field. */
export function parseNodeKey(value: unknown, path = 'node'): NodeKey {
  const o = object(value, path, KEY_FIELDS);
  const key: NodeKey = {
    stake: o.stake === undefined ? '' : text(o.stake, MAX_STAKE_CHARS, `${path}.stake`),
    table_size: o.table_size === undefined ? DEFAULT_TABLE_SIZE : integer(o.table_size, MIN_TABLE_SIZE, MAX_TABLE_SIZE, `${path}.table_size`),
    eff_stack_bb: o.eff_stack_bb === undefined ? DEFAULT_STACK_BB : integer(o.eff_stack_bb, 1, MAX_STACK_BB, `${path}.eff_stack_bb`),
    hero_position: oneOf(o.hero_position, POSITIONS, `${path}.hero_position`),
    villain_position: oneOfOrNull(o.villain_position, POSITIONS, `${path}.villain_position`),
    action_sequence: list(o.action_sequence, MAX_SEQUENCE, `${path}.action_sequence`).map((s, i) => parseStep(s, `${path}.action_sequence[${i}]`)),
    street: o.street === undefined ? 'preflop' : oneOf(o.street, STREETS, `${path}.street`),
    line_so_far: lineOrNull(o.line_so_far, `${path}.line_so_far`),
    size_bucket: oneOfOrNull(o.size_bucket, SIZE_BUCKETS, `${path}.size_bucket`),
    pot_type: oneOfOrNull(o.pot_type, POT_TYPES, `${path}.pot_type`),
    board_texture: list(o.board_texture, MAX_TEXTURE_TAGS, `${path}.board_texture`).map((t, i) => parseTag(t, `${path}.board_texture[${i}]`)),
  };
  checkOneAccountOfThisStreet(key, `${path}.line_so_far`);
  checkSizeBucketIsPostflop(key, `${path}.size_bucket`);
  return key;
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
    // A chart Dexie cached under an earlier build has none of these three; JSON.stringify drops an
    // undefined where a fresh key carries null, and the two would never compare equal.
    line_so_far: key.line_so_far ?? null,
    size_bucket: key.size_bucket ?? null,
    pot_type: key.pot_type ?? null,
    board_texture: [...key.board_texture],
  };
}

/** One string per situation, equal exactly when two keys are the same situation. */
export function canonicalNodeKey(key: NodeKey): string {
  return JSON.stringify(nodeKeyJson(key));
}

/** Whether two keys are the same situation, whatever the key order or spelling of the defaults. */
export function nodeKeyEquals(a: NodeKey, b: NodeKey): boolean {
  return canonicalNodeKey(a) === canonicalNodeKey(b);
}

/**
 * The registry bucket a faced size falls in: the first whose range holds it, a null low meaning
 * 0 and a null high open, low inclusive and high exclusive (`_bucket_of` in node_filter.py) —
 * or null when none does, or the bucket is not a name the key knows. The ranges come from
 * `/v1/definitions` (`facing_size_pct`'s `buckets`): no boundary is written here (ADR-028).
 */
export function sizeBucketOf(sizePct: number, buckets: BucketRanges): SizeBucket | null {
  for (const [name, [low, high]] of Object.entries(buckets)) {
    if (sizePct >= (low ?? 0) && (high === null || sizePct < high)) {
      return (SIZE_BUCKETS as readonly string[]).includes(name) ? (name as SizeBucket) : null;
    }
  }
  return null;
}

// The label lives in `node-label.ts` for size; it is part of this module's surface all the same.
export { nodeKeyLabel } from './node-label';
