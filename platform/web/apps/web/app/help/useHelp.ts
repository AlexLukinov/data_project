/**
 * The one help session for this tab, shared by the shell, the help menu, the tour card and the
 * first-visit offer, so answering the offer in one place hides it everywhere at once.
 *
 * A module-level singleton is enough: the app is a single-page app (`ssr: false`), so there is
 * exactly one reader per module instance. The pure parts are in `./state`, tested there.
 */
import type { HelpSession } from './state';
import { browserStorage, createHelpSession } from './state';

let session: HelpSession | null = null;

export function useHelp(): HelpSession {
  session ??= createHelpSession(browserStorage());
  return session;
}
