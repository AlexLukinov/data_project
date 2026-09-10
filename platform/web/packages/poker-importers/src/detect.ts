/** Which importer a file wants, by extension and then by content; the folder import over it. */
import { detectFormat } from '@poker/core';

import { importCsv } from './csv';
import { importEquilab } from './equilab';
import { ImportError } from './errors';
import { importOwnJson } from './json';
import { importPio } from './pio';
import { joinLines } from './read';
import { importGtoWizard, importPlainText, importSph } from './text';
import type { FileFailure, FileImport, FolderImport, ImportFile, ImportResult, ImporterId } from './types';

const PIO_MARKER = /^#Range\d+#/m;
const EQUILAB_BLOCK = /\[\d+(?:\.\d+)?\][^[]*\[\/\d/;
const BIN_HINT = 'Simple Preflop Holdem .bin files are not supported: in SPH copy each range as text (or export the tree as text files) and import those';

export type Importer = (text: string, name: string) => ImportResult;

export const IMPORTERS: Record<ImporterId, Importer> = {
  sph: importSph,
  json: importOwnJson,
  gtowizard: importGtoWizard,
  pio: importPio,
  equilab: importEquilab,
  csv: importCsv,
  text: importPlainText,
};

function extension(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  return dot < 0 ? '' : leaf.slice(dot + 1).toLowerCase();
}

/** `.json` and `.csv` by extension; Pio by its `#RangeN#` markers; Equilab by `[75]…[/75]`; combo notation is SPH. */
export function detectImporter(file: ImportFile): ImporterId {
  const ext = extension(file.name);
  if (ext === 'json') return 'json';
  if (ext === 'csv') return 'csv';
  if (ext === 'bin') throw new ImportError(BIN_HINT, file.name);
  if (PIO_MARKER.test(file.text)) return 'pio';
  if (EQUILAB_BLOCK.test(file.text)) return 'equilab';
  return detectFormat(joinLines(file.text)) === 'combo' ? 'sph' : 'text';
}

export interface ImportOptions {
  /** Read every file with this importer instead of detecting one per file. */
  readonly importer?: ImporterId;
}

/** Import one file, detecting the importer unless one is forced. Throws `ImportError`. */
export function importText(file: ImportFile, options: ImportOptions = {}): ImportResult {
  const importer = options.importer ?? detectImporter(file);
  return IMPORTERS[importer](file.text, file.name);
}

/** Import a folder: every file either lands in `imported` or in `failed` with its reason. */
export function importFiles(files: readonly ImportFile[], options: ImportOptions = {}): FolderImport {
  const imported: FileImport[] = [];
  const failed: FileFailure[] = [];
  for (const file of files) {
    try {
      imported.push({ file: file.name, result: importText(file, options) });
    } catch (error) {
      failed.push({ file: file.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { imported, failed };
}
