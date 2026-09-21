/**
 * Uploading hand histories and naming the uploader's seats (plan D.8): the transport for
 * `/v1/sites`, `/v1/uploads` and `/v1/auth/poker-accounts`.
 *
 * Field names are the API's (snake_case), exactly as `api/schemas.py` sends them. One file goes up
 * per request, so a folder of hand histories is a sequence of these calls and each file gets its
 * own answer, its own status and its own error sentence.
 */

import type { Fetcher } from '../auth/api';

/** Which hands a file holds: the uploader's own play, or tables they observed. */
export type Dataset = 'hero' | 'population';

/** `queued` → `processing` → `completed` (at least one hand stored) or `failed`. */
export type UploadStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** Whether the bytes were new work, seen before, or seen before as a failure now retried. */
export type Dedupe = 'new' | 'duplicate' | 'requeued';

/** What a file is sent as: `site` '' asks the server to detect it. */
export interface UploadChoice {
  site: string;
  dataset: Dataset;
}

/** `POST /v1/uploads` → 202. For a duplicate, `status` is the earlier upload's. */
export interface UploadAccepted {
  upload_id: string;
  status: UploadStatus;
  dedupe: Dedupe;
}

/** `GET /v1/uploads/{id}`. While processing, the hand counts are the counts so far. */
export interface UploadRow {
  upload_id: string;
  status: UploadStatus;
  site: string;
  /** Null only on rows written before plan D.8. */
  dataset: Dataset | null;
  filename: string;
  byte_size: number;
  hands_found: number;
  hands_parsed: number;
  hands_failed: number;
  /** For a hero upload: stored hands with no seat recognised as the uploader's, left out of My game. */
  hands_without_hero: number;
  /** A sentence for the person when `status` is `failed`; '' otherwise. */
  error_text: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** `GET /v1/auth/poker-accounts`: a screen name the parser treats as the uploader's seat. */
export interface PokerAccount {
  id: string;
  site: string;
  screen_name: string;
  is_verified: boolean;
}

interface SitesOut {
  sites: string[];
}

/** `PokerAccountRequest.screen_name` in `api/schemas.py`, mirrored so the input stops where the server would refuse. */
export const SCREEN_NAME_MAX = 120;

/** The server's default page of recent uploads (`?limit=` takes 1..200). */
export const RECENT_UPLOADS = 50;

export interface UploadsApi {
  /** The sites the parser reads, e.g. `['ggpoker', 'pokerstars']`. */
  sites(): Promise<string[]>;
  /** The newest uploads first. */
  list(limit?: number): Promise<UploadRow[]>;
  get(id: string): Promise<UploadRow>;
  /** One file per call; 202 with the upload's id, or the API's sentence for why it was refused. */
  upload(file: File, choice: UploadChoice): Promise<UploadAccepted>;
  accounts(): Promise<PokerAccount[]>;
  /** 201 with the row; 409 when the name is already there; 422 for an unknown site or an empty name. */
  addAccount(site: string, screenName: string): Promise<PokerAccount>;
  /** 204; 404 when it is not one of this user's. */
  removeAccount(id: string): Promise<void>;
}

/** Bind the upload and poker-account endpoints to a fetcher (the auth store's, which adds the bearer). */
export function createUploadsApi(fetch: Fetcher): UploadsApi {
  return {
    sites: async () => (await fetch<SitesOut>('/v1/sites')).sites,
    list: (limit = RECENT_UPLOADS) => fetch<UploadRow[]>(`/v1/uploads?limit=${limit}`),
    get: (id) => fetch<UploadRow>(`/v1/uploads/${encodeURIComponent(id)}`),
    upload: (file, choice) => {
      const form = new FormData();
      form.append('file', file);
      form.append('site', choice.site);
      form.append('dataset', choice.dataset);
      // ofetch sends a FormData untouched and the browser sets the multipart boundary, so no
      // Content-Type is set here.
      return fetch<UploadAccepted>('/v1/uploads', { method: 'POST', body: form });
    },
    accounts: () => fetch<PokerAccount[]>('/v1/auth/poker-accounts'),
    addAccount: (site, screenName) => fetch<PokerAccount>('/v1/auth/poker-accounts', { method: 'POST', body: { site, screen_name: screenName } }),
    removeAccount: (id) => fetch<void>(`/v1/auth/poker-accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
