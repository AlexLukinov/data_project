/**
 * @poker/core — pure TypeScript poker mathematics for the Range Lab (ADR-027).
 * No Vue, no DOM, no network: everything here runs in a Worker, in Node, or in a test.
 */

export * from './cards';
export * from './range';
export * from './formats/index';
export * from './classify';
export type { HandEvaluator } from './evaluator/types';
export { CATEGORY_NAMES, Category, RANK_BASE, WORST_RANK, categoryOfRank } from './evaluator/types';
export { TsEvaluator, evaluateCards, tsEvaluator } from './evaluator/ts';
export { WasmEvaluator, wasmEvaluator } from './evaluator/wasm';
