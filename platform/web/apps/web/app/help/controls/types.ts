/**
 * What each control does, in one sentence (plan F.13, ADR-058).
 *
 * **Why the words live here and not in the components.** Most of these controls belong to files
 * other lanes own, and several are `<select>`s and sliders that cannot host a child element at
 * all. So this list holds the sentence and `components/help/ControlHelp.vue` attaches it at
 * runtime, by selector — exactly as the tutorial anchors itself on `data-testid`s the pages
 * already carry. Nothing is added to anybody's markup.
 *
 * **What belongs here and what does not.** A sentence about a *control*: what pressing, dragging
 * or choosing this does. The meaning of a stat or a dimension is the registry's, shown through
 * `components/reports/RegistryTerm.vue` (ADR-057); the meaning of a poker word is `@poker/ui`'s
 * vocabulary (ADR-056); what the whole screen is for is `~/help/tools` (ADR-058). A control's
 * sentence may name a term; it never defines one.
 *
 * **Every entry names the file that renders its anchor** and `controls.test.ts` checks the anchor
 * really is in it, so a control that is renamed or moved fails here rather than going quietly
 * unexplained. That test also sweeps every chooser in the app: a new `<select>` fails the suite
 * until it is either explained here or written down as self-evident, with the reason.
 */

export const UI = 'packages/poker-ui/src/components';
export const APP = 'apps/web/app';

export interface ControlHelp {
  /** Stable id: the tip's element id, and what a highlight request names. */
  readonly id: string;
  /** A CSS selector for the control. Every match is attached, so a repeated control is covered. */
  readonly anchor: string;
  /** The file that renders it, relative to `platform/web`. Read by the test, not shown. */
  readonly source: string;
  /** What the control is called on screen. */
  readonly control: string;
  /** What it does. One sentence about the effect of using it. */
  readonly does: string;
  /** Where it is, for the list in the page explainer. */
  readonly where: string;
}

/** The element id of a control's tip. Stable, so `aria-describedby` can be set once. */
export function tipId(id: string): string {
  return `control-help-${id}`;
}
