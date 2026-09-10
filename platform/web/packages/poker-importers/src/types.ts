import type { NodeKey, RangeFormat, WeightedRange } from '@poker/core';

import type { Inference } from './filename';

/** Which reader produced a result; `text` is plain class notation with no tool hallmarks. */
export type ImporterId = 'sph' | 'json' | 'gtowizard' | 'pio' | 'equilab' | 'csv' | 'text';

/** The library's three columns (spec §11.1): my chart, a solver's range, the pool's. */
export type RangeSource = 'own' | 'solver' | 'pool';

export interface ImportedRange {
  readonly name: string;
  readonly range: WeightedRange;
  /** The notation the text was written in. */
  readonly format: RangeFormat;
  /** The situation the file stated (own JSON) or the name implied; null when nothing could be read. */
  readonly nodeKey: NodeKey | null;
  /** How the situation was inferred from the name; null when the file carried it exactly. */
  readonly inference: Inference | null;
  readonly source: RangeSource;
  readonly sourceTool: string;
  readonly tags: readonly string[];
  /** Non-blocking: percentages scaled, duplicates, weights above 1 … */
  readonly warnings: readonly string[];
}

/** One file's worth of ranges. A file that cannot be read throws `ImportError` instead. */
export interface ImportResult {
  readonly importer: ImporterId;
  readonly ranges: readonly ImportedRange[];
  readonly warnings: readonly string[];
}

export interface ImportFile {
  /** The name, with or without directories; the leaf is what inference reads. */
  readonly name: string;
  readonly text: string;
}

export interface FileImport {
  readonly file: string;
  readonly result: ImportResult;
}

export interface FileFailure {
  readonly file: string;
  readonly error: string;
}

/** The report a folder drop produces (spec §11.2): every file either imported or failed, with the reason. */
export interface FolderImport {
  readonly imported: readonly FileImport[];
  readonly failed: readonly FileFailure[];
}
