/**
 * The controls that decide what a screen of numbers is counting: the filter bar, the situation
 * builder, the two pickers, the preset menu, the reading options, the cohorts and the search.
 */
import type { ControlHelp } from './types';
import { APP } from './types';

export const READING_CONTROLS: readonly ControlHelp[] = [
  {
    id: 'dataset',
    anchor: '[data-testid^="filter-dataset-"]',
    source: `${APP}/components/filter/FilterBar.vue`,
    control: 'My hands / The pool',
    does: 'Switches which corpus every number on the page is counted from — your own play, or the field. It changes the hands, never the question.',
    where: 'The filter bar, on Reports and Hands.',
  },
  {
    id: 'filter-edit',
    anchor: '[data-testid="filter-edit"]',
    source: `${APP}/components/filter/FilterBar.vue`,
    control: 'Edit the situation',
    does: 'Opens the builder where conditions are added. Closing it keeps the conditions: it is a drawer, not a cancel.',
    where: 'The filter bar.',
  },
  {
    id: 'situation-builder',
    anchor: '[data-testid="situation-builder"]',
    source: `${APP}/components/filter/SituationBuilder.vue`,
    control: 'The situation builder',
    does: 'Builds the situation one condition at a time — a column, a comparison and a value — and the page is then counted over hands that satisfy all of them at once.',
    where: 'Behind Edit, on Reports, Hands and the Pool.',
  },
  {
    id: 'clause-op',
    anchor: '[data-testid="clause-op"]',
    source: `${APP}/components/filter/ClauseRow.vue`,
    control: 'The comparison',
    does: 'How this condition tests the column: equal to one value, one of several, or above or below a number. Changing it changes what the value box below will accept.',
    where: 'Each row of the situation builder.',
  },
  {
    id: 'situation-chips',
    anchor: '[data-testid="filter-chips"]',
    source: `${APP}/components/filter/FilterBar.vue`,
    control: 'The situation chips',
    does: 'Each chip is one condition currently narrowing the page; its × removes that condition alone and asks the question again.',
    where: 'The filter bar, once conditions are set.',
  },
  {
    id: 'stat-picker',
    anchor: '[data-testid="stat-picker"]',
    source: `${APP}/components/reports/StatPicker.vue`,
    control: 'The stat picker',
    does: 'Chooses which columns the grid holds. A stat the chosen grouping cannot answer is dropped with the reason rather than returned wrong.',
    where: 'Reports and the Pool.',
  },
  {
    id: 'groupby-picker',
    anchor: '[data-testid="groupby-picker"]',
    source: `${APP}/components/reports/GroupByPicker.vue`,
    control: 'The group-by picker',
    does: 'Decides what one row of the grid is: pick nothing for a single row over the whole situation, or stack columns to split it. The order is the nesting order.',
    where: 'Reports and the Pool.',
  },
  {
    id: 'preset-menu',
    anchor: '[data-testid="report-library"]',
    source: `${APP}/components/reports/PresetMenu.vue`,
    control: 'Presets and saved reports',
    does: 'Opens a question somebody has already written — a shipped preset, or one you saved. Opening one replaces the stats, the grouping and the situation on screen.',
    where: 'Reports and the Pool.',
  },
  {
    id: 'save-module',
    anchor: '[data-testid="save-module"]',
    source: `${APP}/components/reports/SaveReportDialog.vue`,
    control: 'Filed under',
    does: 'Which area a saved report is listed in afterwards. It files the report; it does not change what the report asks.',
    where: 'The save dialog on Reports.',
  },
  {
    id: 'min-n',
    anchor: '[data-testid="minn-select"]',
    // Moved out of `ReadingOptions` in F.12 so the Pool stops keeping a second copy of it, and
    // folded: it is the one control on either screen that re-reads the answer instead of
    // re-asking the question, which is what spec §13 puts behind "Advanced".
    source: `${APP}/components/reports/ReadingThreshold.vue`,
    // Was "Hide comparisons under", which named a comparison the Pool never draws (a pool report
    // has no hero seat, so `reports/model.ts` leaves `compare_to` off it) — and no screen spells
    // the control that way. This is the label both screens actually render.
    control: 'grey a cell under',
    does: 'Sets how many observations a cell needs before it counts as read rather than as a handful. Under it the value is still shown, dimmed, and — where a screen draws one at all — its difference from the field is withheld. Nothing is re-asked: the threshold is applied to the answer already on screen.',
    where: 'Behind “Advanced” under the pickers, on Reports and the Pool.',
  },
  {
    id: 'compare-toggle',
    anchor: '[data-testid="compare-toggle"]',
    source: `${APP}/components/reports/ReadingOptions.vue`,
    control: 'Compare each cell with the field',
    does: 'Puts the pool’s figure and the difference beside every cell. With it off you read your own numbers alone.',
    where: 'How to read it, on Reports.',
  },
  {
    id: 'cohort-picker',
    anchor: '[data-testid="cohort-picker"]',
    source: `${APP}/components/pool/CohortPicker.vue`,
    control: 'The cohort picker',
    does: 'Restricts the report to the players a rule currently selects, and can run a second cohort beside the first for a row-by-row comparison.',
    where: 'The Pool.',
  },
  {
    id: 'cohort-rules',
    anchor: '[data-testid="cohort-rules"]',
    source: `${APP}/components/pool/CohortForm.vue`,
    control: 'The rule builder',
    does: 'Writes the rule that decides who is in the cohort — a stat, a comparison and a number, all of which must hold. Only the rule is stored, so membership follows how people are playing now.',
    where: 'Cohorts, when creating or editing one.',
  },
  {
    // The box, not the Search button: the button is disabled until something is typed, and a
    // disabled control takes no focus, so its sentence would be unreachable from a keyboard.
    id: 'player-search',
    anchor: '[data-testid="player-prefix"]',
    source: `${APP}/pages/pool/players.vue`,
    control: 'Player search',
    does: 'Looks for your text anywhere inside a pool player’s name, not only at the start, and the report below is then that one player alone.',
    where: 'Player lookup.',
  },
];
