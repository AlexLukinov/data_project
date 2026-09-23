/**
 * A `NodeKey` as a player would say it: `UTG RFI · 100bb`, `BB raise vs CO 33% · flop · 100bb`.
 *
 * Split from `node.ts` for size only. `node.ts` re-exports `nodeKeyLabel`, so every import of it
 * from there keeps working; nothing else here is public.
 */

import type { ActionStep, NodeKey, Position } from './node';

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
  // A seat that folded is not who hero is playing against — it is who got out of the way.
  const villain = key.villain_position ?? [...key.action_sequence].reverse().find((s) => s.position !== key.hero_position && s.action !== 'fold')?.position ?? null;
  const verb = last !== undefined && last.position === key.hero_position ? heroVerb(key, last) : 'to act';
  const parts = [`${key.hero_position} ${verb}${villain === null ? '' : ` vs ${villain}${facedSize(key, villain)}`}`];
  if (key.street !== 'preflop') parts.push(key.street);
  parts.push(`${key.eff_stack_bb}bb`);
  if (key.stake !== '') parts.push(key.stake);
  return parts.join(' · ');
}
