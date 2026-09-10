/**
 * Filename → situation (spec §11.2): `UTG_RFI_100bb`, `BTN_vs_UTG_3bet`, `BB_defend_vs_CO_2.5x`
 * become a `NodeKey` plus a confidence and notes, so the review table shows what was understood
 * and what was not. Never trusted silently: the reader confirms every row before it is saved.
 *
 * Grammar: positions (UTG … BB and the usual aliases), one action word (RFI, 3bet, call, defend,
 * squeeze, iso, limp, shove, fold), `vs` between hero's side and villain's, `100bb` for the
 * stack (20bb and up), `2.5x` or `2.5bb` for a raise size, `NL5` for the stake, `6max` for the
 * table. Everything else is reported as unrecognised.
 */
import type { ActionStep, NodeAction, NodeKey, Position, Street } from '@poker/core';
import { DEFAULT_STACK_BB, DEFAULT_TABLE_SIZE, nodeKey, step } from '@poker/core';

export type Confidence = 'high' | 'medium' | 'low';

export interface Inference {
  readonly key: NodeKey | null;
  readonly confidence: Confidence;
  /** What the reader should check or fix. */
  readonly notes: readonly string[];
  /** Tokens of the name that meant nothing. */
  readonly unrecognised: readonly string[];
}

type ActionWord = 'rfi' | '3bet' | '4bet' | '5bet' | 'call' | 'squeeze' | 'limp' | 'iso' | 'shove' | 'fold';

const POSITION_ALIASES: Record<string, Position> = {
  utg: 'UTG', ep: 'UTG', lj: 'UTG', utg1: 'UTG1', utg2: 'UTG2', mp: 'MP', mp1: 'MP1', hj: 'HJ', co: 'CO',
  btn: 'BTN', bu: 'BTN', button: 'BTN', sb: 'SB', bb: 'BB',
};
const ACTION_ALIASES: Record<string, ActionWord> = {
  rfi: 'rfi', open: 'rfi', opens: 'rfi', opening: 'rfi', or: 'rfi', raise: 'rfi', raises: 'rfi',
  '3bet': '3bet', '3b': '3bet', threebet: '3bet', '4bet': '4bet', '4b': '4bet', '5bet': '5bet', '5b': '5bet',
  call: 'call', calls: 'call', calling: 'call', flat: 'call', flats: 'call', defend: 'call', defends: 'call', defense: 'call', defence: 'call',
  squeeze: 'squeeze', sqz: 'squeeze', limp: 'limp', limps: 'limp', iso: 'iso', isolate: 'iso',
  shove: 'shove', jam: 'shove', allin: 'shove', push: 'shove', fold: 'fold', folds: 'fold',
};
const TABLE_ALIASES: Record<string, number> = { '6max': 6, '9max': 9, fr: 9, hu: 2, headsup: 2 };
const STREET_WORDS: readonly string[] = ['preflop', 'flop', 'turn', 'river'];
const STOP_WORDS = new Set(['range', 'ranges', 'chart', 'charts', 'from', 'the', 'and', 'to', 'in', 'ip', 'oop', 'with', 'preflop']);
const VS_WORDS = new Set(['vs', 'v', 'against', 'versus']);
/** A number of big blinds this large is a stack; smaller ones are raise sizes. */
const STACK_MIN_BB = 20;

interface Parsed {
  hero: Position | null;
  villain: Position | null;
  word: ActionWord | null;
  sizes: { value: number; afterVs: boolean }[];
  stack: number | null;
  stake: string;
  table: number | null;
  street: Street;
  unrecognised: string[];
}

/** `charts/6max/UTG_RFI.txt` → `UTG_RFI`. An extension starts with a letter, so `CO_2.5x` keeps its size. */
export function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? '';
  return leaf.replace(/\.[a-z][a-z0-9]{0,4}$/i, '');
}

function tokens(stem: string): string[] {
  return stem
    .toLowerCase()
    .replace(/(\d)\s*[-_ ]?\s*bet(?![a-z])/g, '$1bet')
    .replace(/all[-_ ]?in/g, 'allin')
    .replace(/utg\s*\+\s*(\d)/g, 'utg$1')
    .replace(/(\d),(\d)/g, '$1.$2')
    .split(/[\s_\-()[\],]+/)
    .filter((t) => t.length > 0);
}

function readSize(token: string): { value: number; unit: 'bb' | 'x' } | null {
  const m = /^(\d+(?:\.\d+)?)(bb|x)$/.exec(token);
  return m === null ? null : { value: Number(m[1]), unit: m[2] as 'bb' | 'x' };
}

/** Before `vs` the first position is hero's; after it the first is villain's. */
function placePosition(p: Parsed, position: Position, afterVs: boolean): void {
  if (afterVs) {
    if (p.villain === null) p.villain = position;
    else if (p.hero === null) p.hero = position;
  } else if (p.hero === null) p.hero = position;
  else if (p.villain === null) p.villain = position;
}

function classify(p: Parsed, token: string, afterVs: boolean): void {
  const size = readSize(token);
  if (size !== null) {
    if (size.unit === 'bb' && size.value >= STACK_MIN_BB) p.stack = Math.round(size.value);
    else p.sizes.push({ value: size.value, afterVs });
    return;
  }
  const stake = /^nl(\d+)$/.exec(token);
  if (stake !== null) {
    p.stake = `NL${stake[1]}`;
    return;
  }
  const position = POSITION_ALIASES[token];
  if (position !== undefined) return placePosition(p, position, afterVs);
  const word = ACTION_ALIASES[token];
  if (word !== undefined) {
    p.word ??= word;
    return;
  }
  const table = TABLE_ALIASES[token];
  if (table !== undefined) {
    p.table = table;
    return;
  }
  if (STREET_WORDS.includes(token)) p.street = token as Street;
  else if (!STOP_WORDS.has(token)) p.unrecognised.push(token);
}

function parse(stem: string): Parsed {
  const p: Parsed = { hero: null, villain: null, word: null, sizes: [], stack: null, stake: '', table: null, street: 'preflop', unrecognised: [] };
  let afterVs = false;
  for (const token of tokens(stem)) {
    if (VS_WORDS.has(token)) afterVs = true;
    else classify(p, token, afterVs);
  }
  return p;
}

type Builder = (hero: Position, villain: Position) => ActionStep[];

/** The steps a chart's name implies, villain's first: hero's action is always the last one. */
const WITH_VILLAIN: Record<ActionWord, Builder> = {
  rfi: (h) => [step(h, 'raise')],
  limp: (h) => [step(h, 'limp')],
  shove: (h, v) => [step(v, 'raise'), step(h, 'allin')],
  iso: (h, v) => [step(v, 'limp'), step(h, 'raise')],
  '3bet': (h, v) => [step(v, 'raise'), step(h, 'raise')],
  squeeze: (h, v) => [step(v, 'raise'), step(h, 'raise')],
  '4bet': (h, v) => [step(h, 'raise'), step(v, 'raise'), step(h, 'raise')],
  '5bet': (h, v) => [step(v, 'raise'), step(h, 'raise'), step(v, 'raise'), step(h, 'raise')],
  call: (h, v) => [step(v, 'raise'), step(h, 'call')],
  fold: (h, v) => [step(v, 'raise'), step(h, 'fold')],
};
const ALONE: Record<ActionWord, NodeAction> = {
  rfi: 'raise', limp: 'limp', shove: 'allin', iso: 'raise', '3bet': 'raise', squeeze: 'raise', '4bet': 'raise', '5bet': 'raise', call: 'call', fold: 'fold',
};
const MISSING_VILLAIN: Partial<Record<ActionWord, string>> = {
  iso: "the limper's position is missing",
  '3bet': "the opener's position is missing",
  squeeze: "the opener's position is missing",
  '4bet': "the 3-bettor's position is missing",
  '5bet': "the 4-bettor's position is missing",
  call: "the raiser's position is missing",
  fold: "the raiser's position is missing",
};

function sequenceFor(word: ActionWord, hero: Position, villain: Position | null): { steps: ActionStep[]; notes: string[] } {
  const notes: string[] = [];
  if (word === 'squeeze') notes.push('squeeze: add the caller between the open and the 3-bet');
  if (villain !== null) return { steps: WITH_VILLAIN[word](hero, villain), notes };
  const missing = MISSING_VILLAIN[word];
  if (missing !== undefined) notes.push(`${word}: ${missing}`);
  return { steps: [step(hero, ALONE[word])], notes };
}

/** A size before `vs` is hero's, after it villain's; it lands on that seat's first unsized raise. */
function placeSizes(steps: ActionStep[], sizes: Parsed['sizes'], hero: Position, notes: string[]): ActionStep[] {
  const out = [...steps];
  for (const size of sizes) {
    const i = out.findIndex((s) => s.action === 'raise' && s.size_bb === null && (s.position === hero) !== size.afterVs);
    if (i < 0) {
      notes.push(`size ${size.value}bb could not be placed on a raise`);
      continue;
    }
    out[i] = { ...out[i]!, size_bb: size.value };
  }
  return out;
}

/** Read a situation out of a file name. `key` is null only when no position was found. */
export function inferFromName(fileName: string): Inference {
  const p = parse(baseName(fileName));
  if (p.hero === null) {
    return { key: null, confidence: 'low', notes: ['no position found: name the file like UTG_RFI or BB_vs_CO_call'], unrecognised: p.unrecognised };
  }
  const notes: string[] = [];
  let steps: ActionStep[] = [];
  if (p.word === null) notes.push('no action word (RFI, 3bet, call, …): the sequence is empty');
  else {
    const built = sequenceFor(p.word, p.hero, p.villain);
    notes.push(...built.notes);
    steps = placeSizes(built.steps, p.sizes, p.hero, notes);
  }
  const key = nodeKey(p.hero, {
    stake: p.stake,
    table_size: p.table ?? DEFAULT_TABLE_SIZE,
    eff_stack_bb: p.stack ?? DEFAULT_STACK_BB,
    villain_position: p.villain,
    action_sequence: steps,
    street: p.street,
  });
  const confidence: Confidence = p.word === null ? 'low' : notes.length === 0 && p.unrecognised.length === 0 ? 'high' : 'medium';
  return { key, confidence, notes, unrecognised: p.unrecognised };
}
