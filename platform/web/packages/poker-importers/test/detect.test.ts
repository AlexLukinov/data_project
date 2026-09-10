import { describe, expect, it } from 'vitest';

import { detectImporter, importFiles, importText } from '../src/detect';

describe('detectImporter', () => {
  it('picks by extension, then by content', () => {
    expect(detectImporter({ name: 'backup.json', text: '{}' })).toBe('json');
    expect(detectImporter({ name: 'ranges.CSV', text: 'a,b' })).toBe('csv');
    expect(detectImporter({ name: 'spot.txt', text: '#Range0#\nAA\n' })).toBe('pio');
    expect(detectImporter({ name: 'spot.txt', text: '[75]AKo[/75],AA' })).toBe('equilab');
    expect(detectImporter({ name: 'UTG_RFI.txt', text: '# chart\nAsKh: 1,AsAd: 1' })).toBe('sph');
    expect(detectImporter({ name: 'UTG_RFI.txt', text: 'AA,KK,AKs:0.5' })).toBe('text');
  });

  it('refuses .bin with the way round', () => {
    expect(() => detectImporter({ name: '6Max Calculated Preflop Ranges.bin', text: '' })).toThrow('.bin files are not supported: in SPH copy each range as text');
  });
});

describe('importText and importFiles', () => {
  it('forces an importer when asked', () => {
    const result = importText({ name: 'UTG_RFI.txt', text: 'AA,KK' }, { importer: 'gtowizard' });
    expect(result.importer).toBe('gtowizard');
    expect(result.ranges[0]!.sourceTool).toBe('GTO Wizard');
  });

  it('reports every file as imported or failed', () => {
    const folder = importFiles([
      { name: 'charts/UTG_RFI_100bb.txt', text: 'AsAh: 1,AsAd: 1' },
      { name: 'charts/BTN_vs_UTG_3bet.txt', text: 'AA,KK,AKs:0.5' },
      { name: 'charts/broken.txt', text: 'AA,KKx' },
      { name: 'charts/ranges.bin', text: '' },
    ]);
    expect(folder.imported.map((f) => [f.file, f.result.importer, f.result.ranges[0]!.name])).toEqual([
      ['charts/UTG_RFI_100bb.txt', 'sph', 'UTG_RFI_100bb'],
      ['charts/BTN_vs_UTG_3bet.txt', 'text', 'BTN_vs_UTG_3bet'],
    ]);
    expect(folder.failed.map((f) => f.file)).toEqual(['charts/broken.txt', 'charts/ranges.bin']);
    expect(folder.failed[0]!.error).toContain("Couldn't parse range at entry 2");
    expect(folder.failed[1]!.error).toContain('.bin files are not supported');
  });
});
