/**
 * @poker/importers — range files in, ranges with warnings out (spec §11.3, ADR-027). Pure
 * functions over strings; no DOM, no network; depends on @poker/core only. `.bin` is refused with
 * the way round (Appendix A stays backlog).
 */

export { ImportError } from './errors';
export { baseName, inferFromName } from './filename';
export type { Confidence, Inference } from './filename';
export { joinLines, normalizePercentWeights, readRange } from './read';
export type { ReadOptions } from './read';
export { GTO_WIZARD_TOOL, SPH_TOOL, importGtoWizard, importPlainText, importSph } from './text';
export { PIO_TOOL, importPio } from './pio';
export { EQUILAB_TOOL, expandEquilabWeights, importEquilab } from './equilab';
export { importCsv, parseCsv } from './csv';
export { OWN_FORMAT, importOwnJson } from './json';
export { IMPORTERS, detectImporter, importFiles, importText } from './detect';
export type { ImportOptions, Importer } from './detect';
export type { FileFailure, FileImport, FolderImport, ImportFile, ImportResult, ImportedRange, ImporterId, RangeSource } from './types';
