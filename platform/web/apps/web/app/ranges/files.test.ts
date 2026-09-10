import { describe, expect, it } from 'vitest';

import type { EntryLike } from './files';
import { collectEntries, readImportFiles } from './files';

function fileEntry(path: string, text: string): EntryLike {
  const name = path.split('/').pop()!;
  return { isFile: true, isDirectory: false, name, fullPath: `/${path}`, file: (ok) => ok(new File([text], name)) };
}

function dirEntry(path: string, children: EntryLike[]): EntryLike {
  let handed = false;
  return {
    isFile: false,
    isDirectory: true,
    name: path.split('/').pop()!,
    fullPath: `/${path}`,
    createReader: () => ({
      readEntries: (ok) => {
        ok(handed ? [] : children);
        handed = true;
      },
    }),
  };
}

describe('collectEntries', () => {
  it('walks folders depth first, keeps paths, skips hidden files', async () => {
    const drop = [
      dirEntry('charts', [fileEntry('charts/UTG_RFI.txt', 'AA'), dirEntry('charts/3bet', [fileEntry('charts/3bet/BTN_vs_UTG.txt', 'KK')]), fileEntry('charts/.DS_Store', '')]),
      fileEntry('loose.txt', 'QQ'),
    ];
    const files = await collectEntries(drop);
    expect(files.map((f) => f.path)).toEqual(['charts/UTG_RFI.txt', 'charts/3bet/BTN_vs_UTG.txt', 'loose.txt']);
    expect(await readImportFiles(files)).toEqual([
      { name: 'charts/UTG_RFI.txt', text: 'AA' },
      { name: 'charts/3bet/BTN_vs_UTG.txt', text: 'KK' },
      { name: 'loose.txt', text: 'QQ' },
    ]);
  });
});
