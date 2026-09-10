/**
 * Our own JSON (spec §11.3, P0): the backup `GET /v1/ranges/export` writes, read back exactly --
 * the situation is stated, so nothing is inferred. `{ "format": "poker-ranges/1", "ranges": [...] }`.
 */
import { NodeKeyError, parseNodeKey } from '@poker/core';

import { ImportError } from './errors';
import { readRange } from './read';
import type { ImportResult, ImportedRange, RangeSource } from './types';

export const OWN_FORMAT = 'poker-ranges/1';
const SOURCES: readonly RangeSource[] = ['own', 'solver', 'pool'];
const FORMATS = ['combo', 'class'] as const;
const SHAPE_HINT = `expected {"format": "${OWN_FORMAT}", "ranges": [...]} -- the file "Download backup" writes`;

type Plain = Record<string, unknown>;

function plain(value: unknown, path: string, file: string): Plain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ImportError(`${path}: must be an object`, file);
  return value as Plain;
}

function str(value: unknown, path: string, file: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new ImportError(`${path}: must be a string`, file);
  return value;
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], path: string, file: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new ImportError(`${path}: must be one of ${allowed.join(', ')}`, file);
  return value as T;
}

function tags(value: unknown, path: string, file: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) throw new ImportError(`${path}: must be a list of strings`, file);
  return value as string[];
}

function readEntry(value: unknown, i: number, file: string): ImportedRange {
  const path = `ranges[${i}]`;
  const o = plain(value, path, file);
  const name = str(o.name, `${path}.name`, file);
  if (name.trim() === '') throw new ImportError(`${path}.name: must not be empty`, file);
  let nodeKey;
  try {
    nodeKey = parseNodeKey(o.node_key, `${path}.node_key`);
  } catch (error) {
    if (error instanceof NodeKeyError) throw new ImportError(error.message, file);
    throw error;
  }
  return readRange(str(o.weights, `${path}.weights`, file), name, {
    source: enumOf(o.source, SOURCES, `${path}.source`, file, 'own'),
    sourceTool: str(o.source_tool, `${path}.source_tool`, file, ''),
    format: enumOf(o.format, FORMATS, `${path}.format`, file, 'combo'),
    nodeKey,
    tags: tags(o.tags, `${path}.tags`, file),
    file: `${file} ${path}`,
  });
}

/** Read a backup. Every entry carries its exact situation, source, tool and tags. */
export function importOwnJson(text: string, name: string): ImportResult {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new ImportError(`not valid JSON (${error instanceof Error ? error.message : String(error)})`, name);
  }
  const root = plain(document, 'document', name);
  if (root.format !== OWN_FORMAT || !Array.isArray(root.ranges)) throw new ImportError(SHAPE_HINT, name);
  return { importer: 'json', ranges: root.ranges.map((entry, i) => readEntry(entry, i, name)), warnings: [] };
}
