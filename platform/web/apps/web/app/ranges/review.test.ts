import { nodeKey, parseRange, serializeRange, step } from '@poker/core';
import { importFiles } from '@poker/importers';
import { describe, expect, it } from 'vitest';

import { applyToAll, buildReview, duplicateNames, reviewSummary, rowStatus, toBulkBody } from './review';

const FOLDER = importFiles([
  { name: 'charts/UTG_RFI_100bb.txt', text: 'AsAh: 1,AsAd: 1' },
  { name: 'charts/notes.txt', text: 'AA,KK' },
  { name: 'charts/broken.txt', text: 'AA,KKx' },
]);

describe('the import review', () => {
  it('turns the report into rows with a status each', () => {
    const rows = buildReview(FOLDER);
    expect(rows.map((r) => [r.name, rowStatus(r), r.confidence])).toEqual([
      ['UTG_RFI_100bb', 'ready', 'high'],
      ['notes', 'needs-situation', 'low'],
      ['charts/broken.txt', 'failed', null],
    ]);
    expect(rows[1]!.notes[0]).toContain('no position found');
    expect(rows[2]!.error).toContain("Couldn't parse range at entry 2");
    expect(rows[2]!.include).toBe(false);
    expect(reviewSummary(rows)).toEqual({ total: 3, ready: 1, needsSituation: 1, failed: 1, sending: 1 });
  });

  it('sends only the included, ready rows, with the body as combo text', () => {
    const rows = buildReview(FOLDER);
    rows[1] = { ...rows[1]!, key: nodeKey('HJ', { action_sequence: [step('HJ', 'raise')] }), name: 'HJ open' };
    const body = toBulkBody(applyToAll(rows, { source: 'solver', sourceTool: 'SPH', tags: ['batch-1'] }), 'skip');
    expect(body.on_conflict).toBe('skip');
    const combos = (text: string): string => serializeRange(parseRange(text).range, 'combo');
    expect(body.ranges.map((r) => [r.name, r.source, r.source_tool, r.tags, r.weights, r.note])).toEqual([
      ['UTG_RFI_100bb', 'solver', 'SPH', ['batch-1'], combos('AsAh: 1,AsAd: 1'), 'imported from charts/UTG_RFI_100bb.txt'],
      ['HJ open', 'solver', 'SPH', ['batch-1'], combos('AA,KK'), 'imported from charts/notes.txt'],
    ]);
    expect(body.ranges[0]!.weights).toMatch(/^A[a-z]A[a-z]: 1,A[a-z]A[a-z]: 1$/);
    expect(body.ranges[0]!.node_key.hero_position).toBe('UTG');

    const excluded = rows.map((r) => ({ ...r, include: false }));
    expect(toBulkBody(excluded, 'version').ranges).toEqual([]);
    expect(reviewSummary(excluded).sending).toBe(0);
  });

  it('names the duplicates the server would skip', () => {
    const rows = buildReview(FOLDER);
    const twin = { ...rows[0]!, id: 9, range: parseRange('AA').range };
    expect(duplicateNames([...rows, twin])).toEqual(['UTG_RFI_100bb']);
    expect(duplicateNames(rows)).toEqual([]);
  });
});
