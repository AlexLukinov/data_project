/**
 * The review step of a folder import (spec §11.2): one row per range the importers produced,
 * with the inferred situation, its confidence and notes, editable before anything is saved.
 * Framework-free so the rules -- what is ready, what still needs a situation, what is sent --
 * are tested without a page.
 */
import type { NodeKey, RangeFormat, WeightedRange } from '@poker/core';
import { serializeRange } from '@poker/core';
import type { Confidence, FolderImport, RangeSource } from '@poker/importers';

import type { BulkIn, OnConflict, RangeIn } from './api';

export type RowStatus = 'ready' | 'needs-situation' | 'failed';

export interface ReviewRow {
  id: number;
  file: string;
  name: string;
  key: NodeKey | null;
  confidence: Confidence | null;
  /** From the inference and the importer: what to check. */
  notes: string[];
  range: WeightedRange | null;
  format: RangeFormat;
  source: RangeSource;
  sourceTool: string;
  tags: string[];
  error: string | null;
  include: boolean;
}

export interface ReviewSummary {
  total: number;
  ready: number;
  needsSituation: number;
  failed: number;
  /** Rows that will be sent: included and ready. */
  sending: number;
}

/** Rows from an import report: every range becomes a row, every failed file a failed row. */
export function buildReview(folder: FolderImport): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const { file, result } of folder.imported) {
    for (const r of result.ranges) {
      rows.push({
        id: rows.length,
        file,
        name: r.name,
        key: r.nodeKey,
        confidence: r.inference?.confidence ?? null,
        notes: [...(r.inference?.notes ?? []), ...r.warnings, ...result.warnings],
        range: r.range,
        format: r.format,
        source: r.source,
        sourceTool: r.sourceTool,
        tags: [...r.tags],
        error: null,
        include: true,
      });
    }
  }
  for (const { file, error } of folder.failed) {
    rows.push({ id: rows.length, file, name: file, key: null, confidence: null, notes: [], range: null, format: 'combo', source: 'own', sourceTool: '', tags: [], error, include: false });
  }
  return rows;
}

export function rowStatus(row: ReviewRow): RowStatus {
  if (row.error !== null || row.range === null) return 'failed';
  return row.key === null ? 'needs-situation' : 'ready';
}

export function reviewSummary(rows: readonly ReviewRow[]): ReviewSummary {
  const summary: ReviewSummary = { total: rows.length, ready: 0, needsSituation: 0, failed: 0, sending: 0 };
  for (const row of rows) {
    const status = rowStatus(row);
    if (status === 'ready') summary.ready++;
    else if (status === 'needs-situation') summary.needsSituation++;
    else summary.failed++;
    if (row.include && status === 'ready') summary.sending++;
  }
  return summary;
}

/** Apply a source, tool or tags to every row that can be sent. */
export function applyToAll(rows: readonly ReviewRow[], change: Partial<Pick<ReviewRow, 'source' | 'sourceTool' | 'tags'>>): ReviewRow[] {
  return rows.map((row) => (rowStatus(row) === 'failed' ? row : { ...row, ...change }));
}

/** The names sent twice, which the server would skip. */
export function duplicateNames(rows: readonly ReviewRow[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const row of rows) {
    if (!row.include || rowStatus(row) !== 'ready') continue;
    if (seen.has(row.name)) twice.add(row.name);
    seen.add(row.name);
  }
  return [...twice];
}

/** The request for the rows that are included and ready. */
export function toBulkBody(rows: readonly ReviewRow[], onConflict: OnConflict): BulkIn {
  const ranges: RangeIn[] = [];
  for (const row of rows) {
    if (!row.include || rowStatus(row) !== 'ready') continue;
    ranges.push({
      name: row.name.trim(),
      node_key: row.key!,
      source: row.source,
      source_tool: row.sourceTool,
      format: row.format,
      tags: row.tags,
      weights: serializeRange(row.range!, 'combo'),
      note: `imported from ${row.file}`,
    });
  }
  return { ranges, on_conflict: onConflict };
}
