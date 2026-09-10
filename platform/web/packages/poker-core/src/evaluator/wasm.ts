/**
 * PokerHandEvaluator through WebAssembly (`poker-hand-evaluator-wasm`, Apache-2.0).
 *
 * The package exposes an embind module: cards are `Card` objects made from ids, ranks come back
 * as `HandRank` objects. Card ids use the same `rank * 4 + suit` encoding as `cards.ts` (2c = 0,
 * As = 51), so ids pass through untouched. The 52 `Card` objects are created once; every
 * `HandRank` is freed after its value is read, because embind objects live on the WASM heap.
 */

import type { Card } from '../cards';
import { CARD_COUNT } from '../cards';
import type { HandEvaluator } from './types';

/**
 * The package's typings describe the module factory, not the pre-initialized wrapper its ESM
 * entry actually exports; this is the shape of what `import()` gives us. The import is
 * dynamic on purpose: the package instantiates its WebAssembly the moment it is imported and
 * fetches the `.wasm` file next to itself, which only works where that file is served. Nothing
 * pays that cost unless it asks for this evaluator.
 */
interface PheWrapper {
  ready(): Promise<unknown>;
  getRawModule(): unknown;
}

async function loadPhe(): Promise<PheWrapper> {
  const mod = (await import('poker-hand-evaluator-wasm')) as unknown as { default?: PheWrapper } & PheWrapper;
  return mod.default ?? mod;
}

interface PheObject {
  delete?(): void;
}

interface PheHandRank extends PheObject {
  readonly value: number;
}

interface PheModule {
  createCardFromId(id: number): PheObject;
  evaluate7(
    a: PheObject,
    b: PheObject,
    c: PheObject,
    d: PheObject,
    e: PheObject,
    f: PheObject,
    g: PheObject,
  ): PheHandRank;
}

/** The WASM-backed `HandEvaluator`. Call `ready()` once before `rank7`. */
export class WasmEvaluator implements HandEvaluator {
  readonly name = 'phe-wasm';
  private module: PheModule | null = null;
  private cards: PheObject[] = [];

  async ready(): Promise<void> {
    if (this.module !== null) return;
    const phe = await loadPhe();
    await phe.ready();
    const module = phe.getRawModule() as PheModule;
    this.cards = Array.from({ length: CARD_COUNT }, (_, id) => module.createCardFromId(id));
    this.module = module;
  }

  rank7(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card, c5: Card, c6: Card): number {
    if (this.module === null) {
      throw new Error('WasmEvaluator: call ready() before rank7()');
    }
    const cards = this.cards;
    const result = this.module.evaluate7(
      cards[c0]!,
      cards[c1]!,
      cards[c2]!,
      cards[c3]!,
      cards[c4]!,
      cards[c5]!,
      cards[c6]!,
    );
    const value = result.value;
    result.delete?.();
    return value;
  }
}

export const wasmEvaluator: HandEvaluator = new WasmEvaluator();
