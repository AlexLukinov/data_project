/**
 * The plain-text importers (spec §11.3). Simple Preflop Holdem's clipboard/text export is the
 * guaranteed path: combo notation that round-trips byte for byte. GTO Wizard's copy is class
 * notation with fractional weights. Anything else in class notation with no tool hallmark is
 * read as generic text and the reader names the tool in the review table.
 */
import { baseName } from './filename';
import { readRange } from './read';
import type { ImportResult } from './types';

export const SPH_TOOL = 'Simple Preflop Holdem';
export const GTO_WIZARD_TOOL = 'GTO Wizard';

/** Simple Preflop Holdem text: combo notation expected, class notation accepted with a warning. */
export function importSph(text: string, name: string): ImportResult {
  const range = readRange(text, baseName(name), { source: 'own', sourceTool: SPH_TOOL, file: name });
  const warnings = range.format === 'class' ? [`expected ${SPH_TOOL}'s combo notation; read as class notation`] : [];
  return { importer: 'sph', ranges: [range], warnings };
}

/** GTO Wizard's copied range: class notation, weights as fractions or percentages. */
export function importGtoWizard(text: string, name: string): ImportResult {
  const range = readRange(text, baseName(name), { source: 'solver', sourceTool: GTO_WIZARD_TOOL, file: name });
  return { importer: 'gtowizard', ranges: [range], warnings: [] };
}

/** Class or combo notation from an unnamed tool. */
export function importPlainText(text: string, name: string): ImportResult {
  const range = readRange(text, baseName(name), { source: 'own', sourceTool: '', file: name });
  return { importer: 'text', ranges: [range], warnings: [] };
}
