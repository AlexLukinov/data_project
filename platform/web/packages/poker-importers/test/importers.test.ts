import { readFileSync } from 'node:fs';

import { combosIn, handClassName, handClassOf, nodeKey, parseRange, step, totalCombos, weightedCombos } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { importCsv, parseCsv } from '../src/csv';
import { expandEquilabWeights, importEquilab } from '../src/equilab';
import { ImportError } from '../src/errors';
import { importOwnJson } from '../src/json';
import { importPio } from '../src/pio';
import { normalizePercentWeights } from '../src/read';
import { importGtoWizard, importPlainText, importSph } from '../src/text';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The class names with a positive weight, for readable assertions. */
function classes(weights: Float32Array): string[] {
  const names = new Set<string>();
  combosIn({ weights }).forEach((c) => names.add(handClassName(handClassOf(c))));
  return [...names].sort();
}

describe('importSph', () => {
  it('reads SPH combo text and infers the situation from the file name', () => {
    const result = importSph(fixture('UTG_RFI_100bb.txt'), 'charts/UTG_RFI_100bb.txt');
    expect(result.importer).toBe('sph');
    expect(result.warnings).toEqual([]);
    const [range] = result.ranges;
    expect(range!.name).toBe('UTG_RFI_100bb');
    expect(range!.format).toBe('combo');
    expect(range!.sourceTool).toBe('Simple Preflop Holdem');
    expect(range!.source).toBe('own');
    expect(classes(range!.range.weights)).toEqual(['AA', 'AKo', 'AKs', 'KK', 'T9o']);
    expect(range!.nodeKey).toEqual(nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] }));
    expect(range!.inference?.confidence).toBe('high');
    expect(range!.warnings).toEqual(['1 weight exceeds 1 (largest 1.005); normalize to scale the range to 1']);
  });

  it('accepts class notation with a warning and names the failing entry otherwise', () => {
    const result = importSph('AA,KK,AKs:0.5', 'BTN_RFI.txt');
    expect(result.warnings).toEqual(["expected Simple Preflop Holdem's combo notation; read as class notation"]);
    expect(result.ranges[0]!.format).toBe('class');
    expect(() => importSph('AsKh: 1,AKx: 0.5', 'BTN_RFI.txt')).toThrow(ImportError);
    expect(() => importSph('AsKh: 1,AKx: 0.5', 'BTN_RFI.txt')).toThrow('BTN_RFI.txt: Couldn\'t parse range at entry 2');
  });
});

describe('percent weights', () => {
  it('scales weights written as percentages and drops the now-wrong above-1 warning', () => {
    const result = importGtoWizard('AA:100,KK:100,AKs:75,AKo:25', 'BTN_vs_CO_3bet.txt');
    const [range] = result.ranges;
    expect(range!.warnings).toEqual(['weights looked like percentages (largest 100); divided by 100']);
    expect(weightedCombos(range!.range)).toBeCloseTo(6 + 6 + 3 + 3, 5);
    expect(range!.source).toBe('solver');
    expect(range!.sourceTool).toBe('GTO Wizard');
  });

  it('leaves fractions and weights above 100 alone', () => {
    expect(normalizePercentWeights(parseRange('AA:0.5').range).warning).toBeNull();
    expect(normalizePercentWeights(parseRange('AA:250').range).warning).toBeNull();
  });

  it('reads one entry per line and skips comment lines', () => {
    const result = importPlainText('# my chart\nAA\nKK\n// note\nAKs:0.5\n', 'HJ open.txt');
    expect(classes(result.ranges[0]!.range.weights)).toEqual(['AA', 'AKs', 'KK']);
    expect(result.ranges[0]!.sourceTool).toBe('');
  });
});

describe('importPio', () => {
  it('splits a script into the OOP and IP ranges', () => {
    const script = '#Type#NoLimit\n#Range0#\n22+,A2s+,KTs+\n#Range1#\nQQ+,AKs\nAKo\n#Board#\nKh7d2c\n';
    const result = importPio(script, 'srp_CO_vs_BB.txt');
    expect(result.ranges.map((r) => r.name)).toEqual(['srp_CO_vs_BB (OOP)', 'srp_CO_vs_BB (IP)']);
    expect(classes(result.ranges[1]!.range.weights)).toEqual(['AA', 'AKo', 'AKs', 'KK', 'QQ']);
    expect(result.ranges[0]!.sourceTool).toBe('PioSOLVER');
    expect(result.ranges[0]!.source).toBe('solver');
  });

  it('reads plain text and refuses the numeric list with the way round', () => {
    expect(totalCombos(importPio('AA,KK', 'x.txt').ranges[0]!.range)).toBe(12);
    const numbers = `#Range0#\n${Array.from({ length: 40 }, () => '0.5').join(' ')}\n`;
    expect(() => importPio(numbers, 'x.txt')).toThrow('numeric weight list is not supported: copy the range as text');
  });
});

describe('importEquilab', () => {
  it('expands weight blocks', () => {
    expect(expandEquilabWeights('[75]AKo,KQo[/75],AA,[50] 22 [/50]')).toBe('AKo:0.75,KQo:0.75,AA,22:0.5');
    const result = importEquilab('[75]AKo,KQo[/75],AA', 'BB_call_vs_BTN.txt');
    expect(weightedCombos(result.ranges[0]!.range)).toBeCloseTo(12 * 0.75 + 12 * 0.75 + 6, 5);
    expect(result.ranges[0]!.sourceTool).toBe('Equilab');
  });

  it('refuses an unclosed block', () => {
    expect(() => importEquilab('[75]AKo,KQo,AA', 'x.txt')).toThrow('a weight block is not closed');
  });
});

describe('importCsv', () => {
  it('parses quoted fields, a header, and per-row weights as fractions or percentages', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\nf,g\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['f', 'g'],
    ]);
    const csv = 'situation,range,weight\n"UTG RFI 100bb","22+,A2s+",\n"BB defend vs CO 2.5x","AA,KK",50\n"HJ open","QQ",0.25\n';
    const result = importCsv(csv, 'ranges.csv');
    expect(result.ranges.map((r) => r.name)).toEqual(['UTG RFI 100bb', 'BB defend vs CO 2.5x', 'HJ open']);
    expect(result.ranges[1]!.nodeKey?.action_sequence).toEqual([step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')]);
    expect(weightedCombos(result.ranges[1]!.range)).toBeCloseTo(6, 5);
    expect(weightedCombos(result.ranges[2]!.range)).toBeCloseTo(1.5, 5);
  });

  it('works without a header and names the failing row', () => {
    expect(importCsv('"UTG RFI","AA"\n', 'r.csv').ranges[0]!.name).toBe('UTG RFI');
    expect(() => importCsv('"UTG RFI","AA",150\n', 'r.csv')).toThrow('row 1: weight 150 must be a fraction');
    expect(() => importCsv(',"AA"\n', 'r.csv')).toThrow('row 1: the situation column is empty');
    expect(() => importCsv('"UTG RFI","AAx"\n', 'r.csv')).toThrow('r.csv row 1: Couldn\'t parse range');
    expect(() => importCsv('\n\n', 'r.csv')).toThrow('the file is empty');
  });
});

describe('importOwnJson', () => {
  it('reads a backup exactly: stated situation, source, tool, tags', () => {
    const result = importOwnJson(fixture('library.json'), 'library.json');
    expect(result.ranges.map((r) => r.name)).toEqual(['UTG RFI', 'BTN 3bet vs UTG']);
    const [utg, btn] = result.ranges;
    expect(utg!.nodeKey).toEqual(nodeKey('UTG', { action_sequence: [step('UTG', 'raise', { size_bb: 2.5 })] }));
    expect(utg!.inference).toBeNull();
    expect(utg!.tags).toEqual(['rfi', '6max']);
    expect(utg!.sourceTool).toBe('Simple Preflop Holdem');
    expect(totalCombos(utg!.range)).toBe(6);
    expect(btn!.source).toBe('solver');
    expect(btn!.nodeKey?.villain_position).toBe('UTG');
    expect(btn!.format).toBe('combo');
  });

  it('names the failing entry and field', () => {
    expect(() => importOwnJson('{"format": "poker-ranges/1", "ranges": [{"name": "x", "node_key": {"hero_position": "LJ"}, "weights": ""}]}', 'b.json')).toThrow('b.json: ranges[0].node_key.hero_position: must be one of');
    expect(() => importOwnJson('{"format": "poker-ranges/1", "ranges": [{"node_key": {"hero_position": "UTG"}, "weights": ""}]}', 'b.json')).toThrow('ranges[0].name: must be a string');
    expect(() => importOwnJson('{"format": "poker-ranges/1", "ranges": [{"name": "x", "node_key": {"hero_position": "UTG"}, "weights": "", "source": "gto"}]}', 'b.json')).toThrow('ranges[0].source: must be one of own, solver, pool');
    expect(() => importOwnJson('{"ranges": []}', 'b.json')).toThrow('expected {"format": "poker-ranges/1"');
    expect(() => importOwnJson('{not json', 'b.json')).toThrow('b.json: not valid JSON');
  });
});
