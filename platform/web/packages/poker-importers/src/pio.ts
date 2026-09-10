/**
 * PioSOLVER (spec §11.3): a script with `#Range0#` / `#Range1#` sections (OOP and IP), or a
 * plain range text. Pio's other export -- 1326 bare numbers in its own combo order -- is refused
 * with the way round, because guessing the order would store a silently wrong range.
 */
import { ImportError } from './errors';
import { baseName } from './filename';
import { readRange } from './read';
import type { ImportResult, ImportedRange } from './types';

export const PIO_TOOL = 'PioSOLVER';
const MARKER = /^#Range(\d+)#\s*$/;
const ANY_MARKER = /^#[A-Za-z]+#\s*$/;
const NUMERIC_LIST = /^[\d.\s,]+$/;
const SECTION_NAMES: Record<string, string> = { '0': 'OOP', '1': 'IP' };
const NUMBERS_HINT = "PioSOLVER's numeric weight list is not supported: copy the range as text (the Ranges tab, Copy) and import that";

interface Section {
  readonly index: string;
  readonly body: string[];
}

function sections(lines: readonly string[]): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const marker = MARKER.exec(line);
    if (marker !== null) {
      current = { index: marker[1]!, body: [] };
      out.push(current);
    } else if (ANY_MARKER.test(line)) current = null;
    else if (current !== null) current.body.push(line);
  }
  return out;
}

function readSection(body: string, name: string, file: string): ImportedRange {
  if (body.trim() !== '' && NUMERIC_LIST.test(body.trim())) throw new ImportError(NUMBERS_HINT, file);
  return readRange(body, name, { source: 'solver', sourceTool: PIO_TOOL, file });
}

/** A Pio script or range text; each `#RangeN#` section becomes one range named after the file. */
export function importPio(text: string, name: string): ImportResult {
  const stem = baseName(name);
  const found = sections(text.split(/\r?\n/));
  if (found.length === 0) return { importer: 'pio', ranges: [readSection(text, stem, name)], warnings: [] };
  const ranges = found.map((s) => readSection(s.body.join('\n'), `${stem} (${SECTION_NAMES[s.index] ?? `Range${s.index}`})`, name));
  return { importer: 'pio', ranges, warnings: [] };
}
