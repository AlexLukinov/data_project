/**
 * Equilab / Flopzilla (spec §11.3): class notation where a weighted block is written
 * `[75]AKo,KQo[/75]`. The blocks become `AKo:0.75,KQo:0.75` and the class parser does the rest.
 */
import { ImportError } from './errors';
import { baseName } from './filename';
import { readRange } from './read';
import type { ImportResult } from './types';

export const EQUILAB_TOOL = 'Equilab';
const WEIGHTED_BLOCK = /\[(\d+(?:\.\d+)?)\]([^[\]]*)\[\/\1\]/g;
const STRAY_BRACKET = /[[\]]/;
const PERCENT = 100;

/** `[75]AKo,KQo[/75],AA` → `AKo:0.75,KQo:0.75,AA`. Throws on an unbalanced block. */
export function expandEquilabWeights(text: string, file?: string): string {
  const expanded = text.replace(WEIGHTED_BLOCK, (_match, weight: string, body: string) => {
    const factor = Number(weight) / PERCENT;
    return body
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => `${entry}:${factor}`)
      .join(',');
  });
  if (STRAY_BRACKET.test(expanded)) throw new ImportError('a weight block is not closed: write [75]AKo,KQo[/75]', file);
  return expanded;
}

export function importEquilab(text: string, name: string): ImportResult {
  const range = readRange(expandEquilabWeights(text, name), baseName(name), { source: 'own', sourceTool: EQUILAB_TOOL, format: 'class', file: name });
  return { importer: 'equilab', ranges: [range], warnings: [] };
}
