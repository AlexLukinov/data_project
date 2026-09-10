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
| `evaluator/` | `HandEvaluator` — PokerHandEvaluator via WASM, and a pure-TS reference with the same Cactus-Kev ranks | §5.1 |
| `classify.ts` | made-hand and draw classes of two cards on a board, relative to the board | §7.1, §8 |

Coming in later plan steps: `equity/` (F.2), `blockers/`, `distribution/`, `metrics/` (F.3), `node.ts` (F.8).

Conventions worth knowing:

- **Plus notation**: pairs climb (`99+`), connectors climb both cards (`T9s+` → T9s … AKs),
  anything else keeps its high card (`K9s+` → K9s … KQs). A one- or two-gapper below broadway
  (`T8s+`) is read the second way with a warning, because tools disagree.
- **Set semantics on weights**: intersect = min, union = max, subtract = clamped difference;
  multiply with `scale(range, perComboFactor)` when applying an action frequency.
- **Class classes are relative to the board**: on K K 7, `A Q` is ace-high, not "a pair".
