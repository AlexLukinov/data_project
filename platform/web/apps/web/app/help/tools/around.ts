/**
 * Getting around: the account, and this help layer itself.
 *
 * Read from `~/auth/api.ts` and `~/stores/auth.ts` for the account (an access token refreshed
 * silently behind an HttpOnly cookie), and from `~/help/tools/` for the help page.
 */
import type { Tool } from './types';

const AREA = 'Getting around' as const;

export const AROUND_TOOLS: readonly Tool[] = [
  {
    id: 'account',
    area: AREA,
    route: '/account',
    name: 'Account',
    what: 'Who you are signed in as, read live from the server.',
    how: [
      'The page asks the server who the current session belongs to rather than showing what was cached at sign-in, so Reload after a long idle is what proves the silent token refresh is working.',
      'Screen names and uploads are not here — a seat belongs to the hands, so it is set on the Upload page.',
    ],
    steps: [
      'Check the email and display name are the ones you expect.',
      'Press Reload after leaving the tab open for a while; it should answer without sending you to sign in.',
      'Done when the account shown is the one whose hands you are reading.',
    ],
    needs: ['Sign in.'],
    limits: [
      'It shows the account, not the data: nothing about hands, uploads or seats lives here.',
      'Signing out clears the session in this browser only.',
    ],
    related: ['upload', 'help'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  {
    id: 'help',
    area: AREA,
    route: '/help',
    name: 'Help',
    what: 'Every tool in the app, what it is for, and where to start.',
    how: [
      'The list is the catalogue the rest of the help layer reads from: the same sentence that opens a tool’s card on its own page appears here, because a sentence about a tool has exactly one home.',
      'It is client-side data, so the page reads correctly with the API stopped and without signing in — including the entries for screens that do need an account.',
      'The tutorial is built from the same catalogue, one chapter per area.',
    ],
    steps: [
      'Find the area you are working in.',
      'Read the one-liners until one is the thing you were trying to do.',
      'Open the tool, or its worked example if you would rather see it first.',
      'Done when you know which screen answers your question.',
    ],
    needs: [],
    limits: [
      'It describes the tools; it does not contain your data.',
      'A definition of a *stat* or of a poker *word* is not here — those live on the numbers and the words themselves, where you are already reading them.',
    ],
    related: ['examples', 'my-game', 'lab'],
    example: 'top-pair-dry-board',
    account: 'none',
  },
];
