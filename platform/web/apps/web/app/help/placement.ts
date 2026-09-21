/**
 * Where the tour card goes, next to the part of the page it is talking about.
 *
 * Pure geometry over rectangles, so it is tested without a browser: below the anchor when there
 * is room, above it when there is not, and never off either edge of the window. A card that
 * would cover its own anchor either way is pinned to the bottom of the window instead.
 */

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly side: 'below' | 'above' | 'pinned';
}

/** Space kept between the card and the anchor, and between the card and the window's edge. */
export const CARD_GAP = 12;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Whether any of the anchor is still on screen — it scrolls with the page, the card does not. */
function inView(anchor: Box, viewport: Viewport): boolean {
  return anchor.top + anchor.height > 0 && anchor.top < viewport.height;
}

function pinned(card: Pick<Box, 'width' | 'height'>, viewport: Viewport): Placement {
  return { top: viewport.height - card.height - CARD_GAP, left: viewport.width - card.width - CARD_GAP, side: 'pinned' };
}

/**
 * The card's top-left corner for an anchor, in window coordinates. An anchor scrolled out of the
 * window takes the card to the corner rather than off the screen with it — a card the reader
 * cannot see is a tour that has vanished mid-run.
 */
export function placeCard(anchor: Box, card: Pick<Box, 'width' | 'height'>, viewport: Viewport): Placement {
  if (!inView(anchor, viewport)) return pinned(card, viewport);
  const left = clamp(anchor.left, CARD_GAP, viewport.width - card.width - CARD_GAP);
  const below = anchor.top + anchor.height + CARD_GAP;
  if (below + card.height + CARD_GAP <= viewport.height) return { top: clamp(below, CARD_GAP, viewport.height - card.height - CARD_GAP), left, side: 'below' };
  const above = anchor.top - CARD_GAP - card.height;
  if (above >= CARD_GAP) return { top: above, left, side: 'above' };
  return pinned(card, viewport);
}
