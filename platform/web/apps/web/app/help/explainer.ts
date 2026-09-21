/**
 * The three signals the help layer passes between the shell's two components (plan F.13).
 *
 * `PageHelp` and `ControlHelp` are mounted once each, side by side in `app.vue`, and need to say
 * three things to one another that are not worth a store: the header menu has asked for the
 * explainer, the explainer has asked for a control to be pointed at, and these are the controls
 * currently on screen. None of it is persisted — what survives a reload is in `./state.ts`.
 *
 * Module-level singletons for the same reason `useHelp` is one: the app is a single-page app
 * (`ssr: false`), so there is exactly one reader per module instance.
 */
import type { Ref } from 'vue';
import { ref } from 'vue';

const requests = ref(0);
const highlighted = ref('');
const attached = ref<readonly string[]>([]);

/** Bumped when the reader asks for this page's explainer from the header menu. */
export const explainerRequests: Readonly<Ref<number>> = requests;

export function openExplainer(): void {
  requests.value += 1;
}

/** The control the reader has asked to be shown, or `''`. */
export const highlightedControl: Readonly<Ref<string>> = highlighted;

export function highlightControl(id: string): void {
  highlighted.value = id;
}

export function clearHighlight(): void {
  highlighted.value = '';
}

/** The ids of the explained controls currently in the page, newest scan wins. */
export const attachedControls: Readonly<Ref<readonly string[]>> = attached;

export function setAttachedControls(ids: readonly string[]): void {
  const next = [...ids];
  if (next.length === attached.value.length && next.every((id, at) => attached.value[at] === id)) return;
  attached.value = next;
}
