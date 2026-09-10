# @poker/core

Pure TypeScript poker mathematics for the Range Lab (spec: `docs/POKER_RANGE_LAB_SPEC.md`,
ADR-027). No Vue, no DOM, no network — it runs in a Web Worker, in Node, and in tests.

```ts
import { parseRange, serializeRange, removeCards, classifyHand, parseCards, tsEvaluator } from '@poker/core';

const { range, format, warnings } = parseRange('AA,KK,QQ:0.75,AKs,AKo:0.5,A5s-A2s');
const live = removeCards(range, parseCards('As Kd 7h'));       // the board is dead for the range
serializeRange(live, 'combo');                                  // 'KcKh: 1,KcKs: 1,…'
classifyHand(parseCards('Ah Kh') as [number, number], parseCards('Kc 9h 2d')); // { made: 'top_pair', draws: ['backdoor_flush_draw'] }
```

| Module | What it holds | Spec |
|---|---|---|
| `cards.ts` | card = `rank·4 + suit`, combo = `b(b−1)/2 + a`, the 169 classes, canonical spelling | §4.1 |
| `range.ts` | `WeightedRange` and its operations (remove cards, intersect/union/subtract, scale, normalize, filter, matrix, diff) | §4.2 |
| `formats/` | combo notation (byte-identical round trip), class notation (`AQs+`, `A5s-A2s`, `:0.5`), auto-detect, actionable errors | §4.3 |
| `evaluator/` | `HandEvaluator` — `fast.ts` (table-driven, ~75 ns per 7-card rank, what the engine uses), `ts.ts` (the readable reference the tables are built from), `wasm.ts` (PokerHandEvaluator, kept as an agreement check); all three share Cactus Kev's numbering | §5.1 |
| `equity/` | `computeEquity()`: exact heads-up enumeration on flop/turn/river with exact card removal, Monte Carlo for preflop and 3–10 players, cancellation, progress, `equityKey()` for caches | §5.2–5.4 |
| `classify.ts` | made-hand and draw classes of two cards on a board, relative to the board | §7.1, §8 |
| `metrics/` | pot odds and sizing (MDF, alpha, required equity, bluff break-even, odds text, implied odds), rake raw vs adjusted, EQR, range advantage, nut advantage with both threshold modes | §8 |
| `blockers/` | per-combo blocker scores, 52-card removal heatmap overall and per class, class-removal breakdown, board effects, bluff candidates sized to the bet, unblockers | §6 |
| `distribution/` | the grouped combo distribution: six axes, nested tree with raw / weighted / share at every level, compare, CSV and text export | §7 |

```ts
const result = await computeEquity({ ranges: [hero, villain], board: parseCards('Kh 7d 2c') });
result.heroEquity;            // 0.56
result.perComboEquity;        // Float32Array(1326), NaN where the combo is out of range or blocked
result.exact;                 // true on a flop, turn or river with two ranges
await computeEquity({ ranges: [a, b, c], board: [] }, { iterations: 100_000, seed: 1 }); // Monte Carlo, ±confidence95
```

Measured on an M-series Mac (`npm run bench`): flop exact 181 ms (full range vs full range
413 ms), turn 8 ms, river 1 ms, preflop Monte Carlo 100k 74 ms. Expected values in
`fixtures/equity_spots.json` come from an independent brute-force enumeration with the treys
evaluator (`fixtures/gen_equity_spots.py`).

Coming in later plan steps: `node.ts` (F.8).

One formula worth knowing: the balanced bluff-to-value ratio for a bet is `bet / (pot + bet)`
(= alpha), derived from villain's break-even call at `bet / (pot + 2·bet)`; a pot-size bet
carries one bluff per two value combos.

Conventions worth knowing:

- **Plus notation**: pairs climb (`99+`), connectors climb both cards (`T9s+` → T9s … AKs),
  anything else keeps its high card (`K9s+` → K9s … KQs). A one- or two-gapper below broadway
  (`T8s+`) is read the second way with a warning, because tools disagree.
- **Set semantics on weights**: intersect = min, union = max, subtract = clamped difference;
  multiply with `scale(range, perComboFactor)` when applying an action frequency.
- **Class classes are relative to the board**: on K K 7, `A Q` is ace-high, not "a pair".
