/**
 * What a trainer says when it could not work something out (ADR-069).
 *
 * **Nothing here ever mentions the API**, and that is the whole point. Every trainer answer is
 * built from a seed and computed by `@poker/core` in this browser, which is why `/train` and
 * `/progress` are `public: true` and stay correct with the server stopped (`apps/web/README.md`).
 * The gate and the reveal panel both used `describeApiError` — written for HTTP failures, whose
 * branches here are either unreachable (401, 5xx, a bare status) or actively false (its silent
 * fallback is "The API did not answer. Start it with `make api`"). Worse, its remaining branch
 * printed `${name}: ${message}`, so a reader met `EquityCancelled: equity computation cancelled`
 * where a sentence belonged.
 *
 * This is not a third home for the classifier ADR-061 decision 5 warns about. `hands/study.ts`
 * and `analyze/problems.ts` both word *a call that failed*; this words *a calculation that did
 * not finish*, and the distinction is the one the reader needs: there is nothing to retry on a
 * server, and nothing to wait for.
 */

/**
 * The reason something threw, as a sentence — never its class name.
 *
 * `DataCloneError`, `EquityCancelled` and `RangeError` are words for whoever wrote the code.
 * The message is for the reader, and an empty one is better said with nothing at all.
 */
export function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  if (text === '') return '';
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** A lead for this screen, then why nothing on the server is to blame, then what threw. */
export function localProblem(lead: string, error: unknown): string {
  return [lead, IN_THIS_BROWSER, reasonOf(error)].filter((part) => part !== '').join(' ');
}

/**
 * The clause every trainer failure carries. A reader who meets one of these with the API stopped
 * — which is a supported way to use this page — must not go looking for a server.
 */
export const IN_THIS_BROWSER =
  'Every answer here is worked out in this browser rather than on the server, so nothing about the API is the cause.';

/** The gate's lead: the answer is missing, and the control that moves on is already on screen. */
export const CANNOT_ANSWER = 'That answer could not be worked out — skip on to the next spot.';

/** The advantage trainer's reveal: the comparison is missing, which is not the same sentence. */
export const NO_COMPARISON = 'Both ranges’ equities could not be worked out, so there is no comparison to show.';
