import { describe, expect, it } from 'vitest';

import type { EntryLike } from './files';
import { UNREADABLE_DROP, collectEntries, readImportFiles } from './files';

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

describe('a read the browser refuses', () => {
  it('fails the whole read, which is why both screens catch it', async () => {
    const refused = new File([''], 'a.txt');
    refused.text = () => Promise.reject(new Error('ENOENT: no such file or directory'));
    await expect(readImportFiles([{ path: 'charts/a.txt', file: refused }])).rejects.toThrow('ENOENT');
  });

  it('is said in the words of the two pick links both screens carry', () => {
    expect(UNREADABLE_DROP).toContain('files');
    expect(UNREADABLE_DROP).toContain('a folder');
    expect(UNREADABLE_DROP).not.toContain('Error');
  });
});

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
