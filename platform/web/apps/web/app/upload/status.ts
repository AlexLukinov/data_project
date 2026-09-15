/**
 * What the upload screen says about a file (plan D.8), framework-free so every sentence is tested.
 *
 * Two kinds of words. Before a file is sent, the client refuses what the server would refuse
 * anyway and says so in the file's own name — a zip, an empty file. After it is sent, the server's
 * row is the truth: its status, its counts so far, and its `error_text`, shown as the server wrote
 * it. The one thing added here is the hint that a file waiting too long means the parser worker
 * is not running, because nothing on the server can say that about itself.
 */

import { describeApiError } from '../auth/api';
import type { Dataset, UploadAccepted, UploadRow } from './api';

export const DATASET_LABELS: Record<Dataset, string> = {
  hero: 'My hands',
  population: 'Pool hands',
};

/** The badge for a row written before plan D.8, which recorded no dataset. */
export const NO_DATASET_LABEL = 'Dataset not recorded';

/** How long a file may wait for the parser before the screen asks whether the worker is running. */
export const WAIT_HINT_MS = 20_000;

const API_SILENT = 'The API did not answer. Start it with `make api` in platform/ and try again.';
const WORKER_HINT = 'Still waiting. Is the parser worker running? Start it with `make worker` in platform/.';

/** `wait` is still moving; `warn` landed but not all of it counts; `fail` did not land. */
export type Tone = 'wait' | 'ok' | 'warn' | 'fail';

export interface RowState {
  tone: Tone;
  headline: string;
  detail: string;
}

/** Why a file will not be sent, in its own name; null when it may be. */
export function refusal(file: File): string | null {
  if (file.name.toLowerCase().endsWith('.zip')) return `${file.name} is a zip archive. Unzip it and drop the .txt files inside.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/**
 * One sentence for a refused upload, in the server's words: its 400/409/413/415/422/503 detail as
 * sent, a 422's list joined, and a hint to start the API when nothing answered.
 */
export function describeUploadError(error: unknown): string {
  return describeApiError(error, API_SILENT);
}

/** The note beside a file the server had seen before; '' for new work. */
export function dedupeNote(accepted: Pick<UploadAccepted, 'dedupe'>): string {
  switch (accepted.dedupe) {
    case 'new':
      return '';
    case 'duplicate':
      return 'Uploaded before';
    case 'requeued':
      return 'Failed before — trying again';
  }
}

/** A count of hands as prose: "1 hand", "12,408 hands". */
function hands(n: number): string {
  return `${n.toLocaleString('en-US')} hand${n === 1 ? '' : 's'}`;
}

/** Where a row stands, as a headline and an optional detail. `waitedMs` is how long it has been watched. */
export function describeRow(row: UploadRow, { waitedMs }: { waitedMs: number }): RowState {
  switch (row.status) {
    case 'queued':
      return { tone: 'wait', headline: 'Waiting for the parser', detail: waitedMs >= WAIT_HINT_MS ? WORKER_HINT : '' };
    case 'processing':
      return { tone: 'wait', headline: `Reading hands — ${row.hands_parsed.toLocaleString('en-US')} stored so far`, detail: '' };
    case 'completed':
      return describeCompleted(row);
    case 'failed':
      return { tone: 'fail', headline: 'Failed', detail: row.error_text };
  }
}

const NO_DATASET_DETAIL = 'This file was uploaded before uploads recorded a dataset, so this page cannot tell whether its hands are in My game or the pool.';

/**
 * A finished file: how many hands landed, and — for My hands — how many of them count as the
 * uploader's. When none do, the file may well be a table the uploader only observed; that is said
 * too, with the fact that makes it matter: the server keeps a file in the dataset it was first
 * uploaded as, so it cannot be moved to Pool hands from here.
 */
function describeCompleted(row: UploadRow): RowState {
  const unread = row.hands_failed > 0 ? `, ${row.hands_failed.toLocaleString('en-US')} could not be read` : '';
  const headline = `${hands(row.hands_parsed)} in${unread}`;
  if (row.dataset === null) return { tone: 'warn', headline, detail: NO_DATASET_DETAIL };
  const missing = row.hands_without_hero;
  if (row.dataset !== 'hero' || missing <= 0) return { tone: 'ok', headline, detail: '' };
  if (missing < row.hands_parsed) {
    const detail = `${missing.toLocaleString('en-US')} of these ${hands(row.hands_parsed)} have no seat recognised as yours and are not counted in My game.`;
    return { tone: 'warn', headline, detail };
  }
  const advice = `add your screen name for ${row.site} under Poker accounts before uploading more.`;
  const observed =
    'If the file is from a table you observed rather than played, it cannot be moved to Pool hands from this page: the server refuses the same file under the other dataset.';
  const detail =
    row.hands_parsed === 1
      ? `This hand has no seat recognised as yours, so My game does not count it. If it is your hand, ${advice} ${observed}`
      : `None of these ${hands(row.hands_parsed)} has a seat recognised as yours, so My game does not count them. If they are your hands, ${advice} ${observed}`;
  return { tone: 'warn', headline, detail };
}

/** An API timestamp as local `YYYY-MM-DD HH:MM`; the text itself when it does not parse. */
export function uploadedAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
