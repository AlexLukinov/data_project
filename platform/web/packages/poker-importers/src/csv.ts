/**
 * Generic CSV (spec §11.3): `situation,range,weight` -- one range per row, the range text
 * quoted because it contains commas, the weight optional (a fraction or a percentage applied to
 * the whole row). A header row is recognised by its words.
 */
import { scale } from '@poker/core';

import { ImportError } from './errors';
import { readRange } from './read';
import type { ImportResult, ImportedRange } from './types';

const HEADER_WORDS = new Set(['situation', 'name', 'node', 'range', 'weights', 'weight']);
const SITUATION_COLUMNS = ['situation', 'name', 'node'];
const RANGE_COLUMNS = ['range', 'weights'];
const PERCENT = 100;

/** RFC 4180 rows: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

interface Columns {
  situation: number;
  range: number;
  weight: number | null;
}

function columns(first: string[]): Columns | null {
  const words = first.map((c) => c.trim().toLowerCase());
  if (!words.every((w) => HEADER_WORDS.has(w))) return null;
  const situation = words.findIndex((w) => SITUATION_COLUMNS.includes(w));
  const range = words.findIndex((w) => RANGE_COLUMNS.includes(w));
  const weight = words.findIndex((w) => w === 'weight');
  if (situation < 0 || range < 0) return null;
  return { situation, range, weight: weight < 0 ? null : weight };
}

function rowFactor(cell: string | undefined, row: number, file: string): number {
  if (cell === undefined || cell.trim() === '') return 1;
  const value = Number(cell);
  if (!Number.isFinite(value) || value <= 0 || value > PERCENT) throw new ImportError(`row ${row}: weight ${cell.trim()} must be a fraction (0.75) or a percentage (75)`, file);
  return value > 1 ? value / PERCENT : value;
}

function readRow(cells: string[], at: Columns, row: number, file: string): ImportedRange {
  const situation = (cells[at.situation] ?? '').trim();
  if (situation === '') throw new ImportError(`row ${row}: the situation column is empty`, file);
  const factor = rowFactor(at.weight === null ? undefined : cells[at.weight], row, file);
  const read = readRange(cells[at.range] ?? '', situation, { source: 'own', sourceTool: '', file: `${file} row ${row}` });
  return factor === 1 ? read : { ...read, range: { weights: scale(read.range, factor).weights, label: read.name } };
}

/** Every row becomes one range named by its situation cell, which is also what the inference reads. */
export function importCsv(text: string, name: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ImportError('the file is empty', name);
  const header = columns(rows[0]!);
  const at: Columns = header ?? { situation: 0, range: 1, weight: 2 };
  const body = header === null ? rows : rows.slice(1);
  const ranges = body.map((cells, i) => readRow(cells, at, i + (header === null ? 1 : 2), name));
  return { importer: 'csv', ranges, warnings: [] };
}
