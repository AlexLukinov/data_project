import { describe, expect, it } from 'vitest';

import { CARD_GAP, placeCard } from './placement';

const WINDOW = { width: 1280, height: 800 };
const CARD = { width: 320, height: 200 };

describe('placeCard', () => {
  it('sits below the anchor, lined up with its left edge, when there is room', () => {
    expect(placeCard({ top: 100, left: 200, width: 400, height: 50 }, CARD, WINDOW)).toEqual({ top: 150 + CARD_GAP, left: 200, side: 'below' });
  });

  it('goes above an anchor near the bottom of the window', () => {
    expect(placeCard({ top: 600, left: 200, width: 400, height: 100 }, CARD, WINDOW)).toEqual({ top: 600 - CARD_GAP - 200, left: 200, side: 'above' });
  });

  it('never runs off the right or the left edge', () => {
    expect(placeCard({ top: 100, left: 1200, width: 60, height: 20 }, CARD, WINDOW).left).toBe(1280 - 320 - CARD_GAP);
    expect(placeCard({ top: 100, left: -40, width: 60, height: 20 }, CARD, WINDOW).left).toBe(CARD_GAP);
  });

  it('pins itself to the corner when the anchor fills the window and neither side has room', () => {
    expect(placeCard({ top: 20, left: 0, width: 1280, height: 760 }, CARD, WINDOW)).toEqual({ top: 800 - 200 - CARD_GAP, left: 1280 - 320 - CARD_GAP, side: 'pinned' });
  });

  it('keeps the card on screen in a window narrower than the card', () => {
    expect(placeCard({ top: 10, left: 50, width: 100, height: 20 }, CARD, { width: 300, height: 800 }).left).toBe(CARD_GAP);
  });

  it('parks in the corner when the anchor has been scrolled out of the window, above or below', () => {
    expect(placeCard({ top: -420, left: 200, width: 400, height: 20 }, CARD, WINDOW)).toEqual({ top: 800 - 200 - CARD_GAP, left: 1280 - 320 - CARD_GAP, side: 'pinned' });
    expect(placeCard({ top: 900, left: 200, width: 400, height: 20 }, CARD, WINDOW).side).toBe('pinned');
  });

  it('never puts the card above the top edge while the anchor is half off the top', () => {
    const placement = placeCard({ top: -30, left: 200, width: 400, height: 50 }, CARD, WINDOW);
    expect(placement.side).toBe('below');
    expect(placement.top).toBeGreaterThanOrEqual(CARD_GAP);
  });
});
