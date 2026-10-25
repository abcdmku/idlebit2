import { describe, expect, it } from 'vitest';
import { CASES, rackCase } from './fixtures';
import { FOCUS, ROW_PITCH, colX } from './layout';
import { clampScroll, createRowScroll, rackScale } from './row';

// A desktop free world: 864 × 516 CSS px at N = 3; the cabinet (221 tall) rests at 2, so 432 art px wide.
const AREA = { w: 864, h: 516, scale: 3 }, VIEW_W = 432;
/** The art x of the view's left edge for an offset. */
const leftEdge = (col: number, offset: number) => colX(col) + FOCUS.x + FOCUS.w / 2 + offset - VIEW_W / 2;

describe('rack row framing (A06)', () => {
  it('rests the cabinet whole at the largest scale that fits', () => {
    expect(rackScale(AREA)).toBe(2);
    expect(rackScale({ w: 2000, h: 1000, scale: 3 })).toBe(3);
  });
  it('stops the first and last built racks at the view edges', () => {
    const s = CASES.full(0); // slot 2 of a full row of 8
    const lo = clampScroll(s, -1e6, 1, VIEW_W), hi = clampScroll(s, 1e6, 1, VIEW_W);
    expect(leftEdge(2, lo)).toBe(colX(0) + FOCUS.x);
    expect(leftEdge(2, hi) + VIEW_W).toBe(colX(7) + FOCUS.x + FOCUS.w);
    // A lone rack, narrower than the view, centres.
    expect(clampScroll(CASES.alone(0), 300, 1, VIEW_W)).toBe(0);
  });
  it('snaps to the rack pitch when a gesture ends', () => {
    const scroll = createRowScroll(), s = CASES.full(0);
    scroll.setStep(1); scroll.apply(s, AREA);
    scroll.setDragging(true); scroll.scrollBy(170); scroll.setDragging(false);
    const edge = leftEdge(2, scroll.offset) - (colX(0) + FOCUS.x);
    expect(edge % ROW_PITCH).toBe(0);
    expect(scroll.scale).toBe(2);
  });
  it('a tapped neighbour holds the camera for a frame, then settles at its framed rest', () => {
    const scroll = createRowScroll(), a = rackCase({ id: 0, slot: 2, built: [0, 1, 2, 3, 4, 5, 6, 7] }, 0);
    const b = rackCase({ id: 7, slot: 5, built: [0, 1, 2, 3, 4, 5, 6, 7] }, 0);
    scroll.setStep(1); scroll.apply(a, AREA);
    const before = colX(2) + scroll.offset;
    scroll.holdView();
    expect(colX(5) + scroll.apply(b, AREA)).toBe(before);
    expect(scroll.apply(b, AREA)).toBe(clampScroll(b, 0, 1, VIEW_W));
  });
});
