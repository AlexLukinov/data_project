/**
 * The heuristic log (spec §16): "step-9 takeaways linked to their analysis, tagged by
 * texture/position/street, with a 'still true?' review prompt after 14 days".
 *
 * **Local first, server as the record.** Every change lands in Dexie immediately and is marked
 * unsaved; the push follows and clears the mark. With the API away the log still reads, still
 * writes and still asks its questions — only the sync waits. That is the same bargain the
 * analyzer struck in F.9, with one difference: a heuristic written offline has no server id yet,
 * so it keeps its own and adopts the server's when it finally gets one.
 *
 * Whether a heuristic is due is computed here from `@poker/core`'s `heuristicIsDue`, not read
 * from the server's `is_due`, so an offline log answers the question the same way an online one
 * does. The interval is 14 days in both places; a test pins the constant on each side.
 */
import { heuristicDueAt, heuristicIsDue } from '@poker/core';
import type { Ref } from 'vue';
import { shallowRef } from 'vue';

import { describeApiError } from '../auth/api';

import type { HeuristicBody, HeuristicCandidate, HeuristicStatus, HeuristicsApi } from './api';
import type { HeuristicCache, LocalHeuristic } from './cache';
import { fromServer } from './cache';

export type LogStatus = 'idle' | 'loading' | 'ready' | 'offline';

const OFFLINE = 'Saved in this browser only — the server did not answer.';

/** What writing a heuristic needs. Only the lesson itself is required. */
export interface HeuristicDraft {
  readonly text: string;
  readonly analysis_id?: string | null;
  readonly street?: string;
  readonly position?: string;
  readonly texture?: string;
  readonly tags?: readonly string[];
}

export interface HeuristicLog {
  readonly items: Ref<LocalHeuristic[]>;
  readonly candidates: Ref<HeuristicCandidate[]>;
  readonly status: Ref<LogStatus>;
  readonly error: Ref<string>;
  load(): Promise<void>;
  add(draft: HeuristicDraft): Promise<void>;
  /** Answer "still true?" — any answer resets the fourteen-day clock. */
  answer(localId: string, status: HeuristicStatus): Promise<void>;
  remove(localId: string): Promise<void>;
  adopt(candidate: HeuristicCandidate): Promise<void>;
}

export interface LogDeps {
  readonly now?: () => Date;
  readonly id?: () => string;
}

interface Ctx {
  readonly api: HeuristicsApi;
  readonly cache: HeuristicCache;
  readonly now: () => Date;
  readonly id: () => string;
  readonly items: Ref<LocalHeuristic[]>;
  readonly candidates: Ref<HeuristicCandidate[]>;
  readonly status: Ref<LogStatus>;
  readonly error: Ref<string>;
}

/** When a heuristic's "still true?" prompt falls due. */
export function dueAt(row: LocalHeuristic): string {
  return heuristicDueAt(row.confirmed_at ?? row.created_at);
}

/** Whether the prompt is owed, by the same rule the server uses. */
export function isDue(row: LocalHeuristic, now: Date): boolean {
  return row.status !== 'retired' && heuristicIsDue(row.created_at, row.confirmed_at, now);
}

/** Newest first, but anything awaiting its review comes first of all. */
export function ordered(rows: readonly LocalHeuristic[], now: Date): LocalHeuristic[] {
  return [...rows].sort((a, b) => {
    const byDue = Number(isDue(b, now)) - Number(isDue(a, now));
    return byDue !== 0 ? byDue : b.created_at.localeCompare(a.created_at);
  });
}

function draftRow(ctx: Ctx, draft: HeuristicDraft): LocalHeuristic {
  const at = ctx.now().toISOString();
  return {
    local_id: ctx.id(),
    server_id: null,
    text: draft.text.trim(),
    analysis_id: draft.analysis_id ?? null,
    street: draft.street ?? '',
    position: draft.position ?? '',
    texture: draft.texture ?? '',
    tags: [...(draft.tags ?? [])],
    status: 'open',
    confirmed_at: null,
    created_at: at,
    updated_at: at,
    unsaved: true,
  };
}

function bodyOf(row: LocalHeuristic): HeuristicBody {
  return {
    text: row.text,
    analysis_id: row.analysis_id,
    street: row.street,
    position: row.position,
    texture: row.texture,
    tags: [...row.tags],
    status: row.status,
  };
}

/** Write a row locally and put it at the head of the list. */
async function keep(ctx: Ctx, row: LocalHeuristic): Promise<void> {
  ctx.items.value = ordered(
    [row, ...ctx.items.value.filter((item) => item.local_id !== row.local_id)],
    ctx.now(),
  );
  await ctx.cache.put(row).catch(() => undefined);
}

/**
 * Try to push one row. A refusal is not an error the user has to act on — the row stays, marked
 * unsaved, and the next load or change tries again.
 */
async function push(ctx: Ctx, row: LocalHeuristic): Promise<void> {
  try {
    const saved =
      row.server_id === null
        ? await ctx.api.create(bodyOf(row))
        : await ctx.api.update(row.server_id, bodyOf(row));
    await keep(ctx, fromServer(saved, row.local_id));
    ctx.status.value = 'ready';
    ctx.error.value = '';
  } catch {
    ctx.status.value = 'offline';
    ctx.error.value = OFFLINE;
  }
}

/**
 * The server's rows, with any local change that has not reached it yet kept on top.
 *
 * A saved local row the server no longer lists was deleted from somewhere else, and is dropped
 * here too — the server is the record. An unsaved one is never dropped, whatever the server says.
 */
export function merge(
  local: readonly LocalHeuristic[],
  server: readonly LocalHeuristic[],
): LocalHeuristic[] {
  const pending = local.filter((row) => row.unsaved);
  const held = new Set<string>(
    pending.map((row) => row.server_id).filter((id): id is string => id !== null),
  );
  return [...pending, ...server.filter((row) => row.server_id === null || !held.has(row.server_id))];
}

async function load(ctx: Ctx): Promise<void> {
  ctx.status.value = 'loading';
  const local = await ctx.cache.all().catch((): LocalHeuristic[] => []);
  ctx.items.value = ordered(local, ctx.now());
  try {
    const known = new Map(local.map((row) => [row.server_id, row.local_id]));
    const server = (await ctx.api.list()).map((row) =>
      fromServer(row, known.get(row.id) ?? ctx.id()),
    );
    ctx.items.value = ordered(merge(local, server), ctx.now());
    ctx.candidates.value = await ctx.api.candidates();
    ctx.status.value = 'ready';
    ctx.error.value = '';
    for (const row of ctx.items.value.filter((item) => item.unsaved)) await push(ctx, row);
    // Write back whatever is on screen, never the raw server list: a push that was refused must
    // not have its local row overwritten by the server's older copy.
    for (const row of ctx.items.value) await ctx.cache.put(row).catch(() => undefined);
  } catch (error) {
    ctx.status.value = 'offline';
    ctx.error.value = describeApiError(error, OFFLINE);
  }
}

async function answer(ctx: Ctx, localId: string, status: HeuristicStatus): Promise<void> {
  const row = ctx.items.value.find((item) => item.local_id === localId);
  if (row === undefined) return;
  const at = ctx.now().toISOString();
  const next: LocalHeuristic = { ...row, status, confirmed_at: at, updated_at: at, unsaved: true };
  await keep(ctx, next);
  await push(ctx, next);
}

async function remove(ctx: Ctx, localId: string): Promise<void> {
  const row = ctx.items.value.find((item) => item.local_id === localId);
  if (row === undefined) return;
  ctx.items.value = ctx.items.value.filter((item) => item.local_id !== localId);
  await ctx.cache.remove(localId).catch(() => undefined);
  if (row.server_id === null) return;
  try {
    await ctx.api.remove(row.server_id);
  } catch (error) {
    ctx.error.value = describeApiError(error, OFFLINE);
  }
}

/** The whole log. Dependencies are interfaces, so the tests drive it with the server away. */
export function createHeuristicLog(
  api: HeuristicsApi,
  cache: HeuristicCache,
  deps: LogDeps = {},
): HeuristicLog {
  const ctx: Ctx = {
    api,
    cache,
    now: deps.now ?? ((): Date => new Date()),
    id: deps.id ?? ((): string => crypto.randomUUID()),
    items: shallowRef<LocalHeuristic[]>([]),
    candidates: shallowRef<HeuristicCandidate[]>([]),
    status: shallowRef<LogStatus>('idle'),
    error: shallowRef(''),
  };

  async function add(draft: HeuristicDraft): Promise<void> {
    const row = draftRow(ctx, draft);
    await keep(ctx, row);
    await push(ctx, row);
  }

  return {
    items: ctx.items,
    candidates: ctx.candidates,
    status: ctx.status,
    error: ctx.error,
    load: () => load(ctx),
    add,
    answer: (localId, status) => answer(ctx, localId, status),
    remove: (localId) => remove(ctx, localId),
    async adopt(candidate: HeuristicCandidate): Promise<void> {
      await add({ text: candidate.heuristic, analysis_id: candidate.analysis_id });
      ctx.candidates.value = ctx.candidates.value.filter(
        (item) => item.analysis_id !== candidate.analysis_id,
      );
    },
  };
}
