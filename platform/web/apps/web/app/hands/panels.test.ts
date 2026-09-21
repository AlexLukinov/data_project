import type { NodeKey } from '@poker/core';
import { canonicalNodeKey } from '@poker/core';
import { describe, expect, it, vi } from 'vitest';

import { GG_HAND } from '../../../../packages/poker-core/test/fixtures/hand';
import type { StoredRange } from '../ranges/api';
import { createNodeRangeReader, villainStep } from './panels';

function stored(name: string): StoredRange {
  return { id: name, name, node_key: {} as NodeKey, source: 'own', source_tool: '', format: 'combo', tags: [], version: 1, created_at: '', updated_at: '', weights: 'AsAh: 1', note: '' };
}

describe('villainStep', () => {
  it('is the step after the other seat last acted', () => {
    // Hero 3-bets at action 6; the button's raise before it is action 5, so the villain node is 6.
    expect(villainStep(GG_HAND, 7)).toBe(6);
    // The button's own call at action 8 answers hero's 3-bet at action 6.
    expect(villainStep(GG_HAND, 9)).toBe(7);
  });

  it('is the deal when nobody else has acted', () => {
    expect(villainStep(GG_HAND, 0)).toBe(0);
    expect(villainStep(GG_HAND, 3)).toBe(0);
  });
});

describe('createNodeRangeReader', () => {
  it('asks the library for my node and for what the other seat did', async () => {
    const lookup = vi.fn(async (key: NodeKey) => [stored(key.hero_position)]);
    const reader = createNodeRangeReader(lookup);

    const found = await reader.at(GG_HAND, 7);
    expect(found.mine?.name).toBe('SB');
    expect(found.villain?.name).toBe('BTN');
    expect(found.villainNode?.hero_position).toBe('BTN');
  });

  it('asks once per situation, however often the step is revisited', async () => {
    const seen: string[] = [];
    const lookup = vi.fn(async (key: NodeKey) => {
      seen.push(canonicalNodeKey(key));
      return [] as StoredRange[];
    });
    const reader = createNodeRangeReader(lookup);
    await reader.at(GG_HAND, 7);
    await reader.at(GG_HAND, 7);
    await reader.at(GG_HAND, 7);
    // Hero's node and the villain's, once each, however many times the step is shown.
    expect(new Set(seen).size).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('reports a library it could not read as failed, not as nothing stored', async () => {
    const reader = createNodeRangeReader(() => Promise.reject(new Error('the offline copy failed too')));
    const found = await reader.at(GG_HAND, 7);
    expect(found).toEqual({ mine: null, villain: null, villainNode: expect.anything(), failed: true });
  });

  it('asks again on the next step, having cached nothing a failure produced', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('the offline copy failed too')).mockResolvedValue([stored('SB')]);
    const reader = createNodeRangeReader(lookup);

    expect((await reader.at(GG_HAND, 7)).failed).toBe(true);
    const second = await reader.at(GG_HAND, 7);
    expect(second.failed).toBe(false);
    expect(second.mine?.name).toBe('SB');
  });

  it('asks again for a situation the offline copy said it had nothing for', async () => {
    // The cached copy knows only the charts the library held when it was last listed, so its
    // "nothing here" must not become this page's answer for the rest of the session.
    let offline = true;
    const lookup = vi.fn(async () => (offline ? [] : [stored('SB')]));
    const reader = createNodeRangeReader(lookup, () => offline);

    expect((await reader.at(GG_HAND, 7)).mine).toBeNull();
    offline = false;
    expect((await reader.at(GG_HAND, 7)).mine?.name).toBe('SB');
  });
});
