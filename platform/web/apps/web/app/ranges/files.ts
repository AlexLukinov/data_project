/**
 * The files behind a folder drop or a folder pick (spec §11.2: "drag a folder of range files
 * onto the app"). Directory entries are walked recursively; hidden files (`.DS_Store`) are
 * skipped. Typed structurally so the walk is tested without a browser.
 */
import type { ImportFile } from '@poker/importers';

export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath: string;
  file?(ok: (file: File) => void, fail: (error: unknown) => void): void;
  createReader?(): { readEntries(ok: (entries: EntryLike[]) => void, fail: (error: unknown) => void): void };
}

export interface PathedFile {
  readonly path: string;
  readonly file: File;
}

const HIDDEN = /^\./;

function fileOf(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file!(resolve, reject));
}

/** A directory reader hands entries out in batches until an empty one. */
async function childrenOf(entry: EntryLike): Promise<EntryLike[]> {
  const reader = entry.createReader!();
  const all: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** Every file under the entries, depth first, with its path inside the drop. */
export async function collectEntries(entries: readonly EntryLike[]): Promise<PathedFile[]> {
  const out: PathedFile[] = [];
  for (const entry of entries) {
    if (HIDDEN.test(entry.name)) continue;
    if (entry.isFile && entry.file) out.push({ path: entry.fullPath.replace(/^\//, ''), file: await fileOf(entry) });
    else if (entry.isDirectory && entry.createReader) out.push(...(await collectEntries(await childrenOf(entry))));
  }
  return out;
}

/** The entries of a drop; browsers expose them through `webkitGetAsEntry`. */
export function entriesOf(transfer: DataTransfer): EntryLike[] {
  const entries: EntryLike[] = [];
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry() as EntryLike | null;
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/** The files of an `<input type="file" webkitdirectory>` pick, with their relative paths. */
export function pickedFiles(list: FileList): PathedFile[] {
  return Array.from(list)
    .filter((file) => !HIDDEN.test(file.name))
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** Read the texts; a file that cannot be read becomes an empty text the importer rejects. */
export async function readImportFiles(files: readonly PathedFile[]): Promise<ImportFile[]> {
  return Promise.all(files.map(async ({ path, file }) => ({ name: path, text: await file.text() })));
}
