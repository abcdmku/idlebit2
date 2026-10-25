import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camera } from './camera';
import { rect } from './geom';
import { DESKTOP_TYPE } from './labels';
import { POP_LIFE_MS, POP_MERGE_MS, PayoutPops, completionMs } from './pops';
import type { Completion } from './pops';
import { recordingContext } from './testCanvas';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());
const VP = rect(0, 0, 600, 400), RATIO = { x: 1, y: 1 };
// One art px = 3 CSS px, world origin at the viewport centre.
const CAM = Object.assign(camera(), { cx: 0, cy: 0, s: 3 });
function frame(pops: PayoutPops, nowMs: number): string[] {
  const rec = recordingContext();
  pops.draw(rec.g, nowMs, CAM, VP, RATIO, DESKTOP_TYPE, 3, VP, false);
  return rec.texts.map(t => t.text);
}
const LEFT = rect(-40, 0, 16, 8), RIGHT = rect(40, 0, 16, 8), NEXT = rect(-36, 0, 16, 8);

describe('payout pops', () => {
  it('sums completions on one component inside the merge window into one pop', () => {
    const pops = new PayoutPops();
    pops.add(0, LEFT, 1000, 5, 0); pops.add(0, LEFT, 1050, 7, 2.4);
    expect(frame(pops, 1060)).toEqual(['+12', '+2']);
    pops.add(0, LEFT, 1000 + POP_MERGE_MS - 10, 3, 0);
    expect(frame(pops, 1250)).toEqual(['+15', '+2']);
    expect(pops.live).toBe(1);
  });
  it('replaces a component pop with a fresh one after the merge window, and retires it after its life', () => {
    const pops = new PayoutPops();
    pops.add(0, LEFT, 1000, 5, 0); frame(pops, 1000);
    pops.add(0, LEFT, 1400, 9, 0);
    expect(frame(pops, 1400)).toEqual(['+9']);
    expect(frame(pops, 1400 + POP_LIFE_MS)).toEqual([]);
  });
  it('keeps one pop per component side by side when plates do not overlap', () => {
    const pops = new PayoutPops();
    pops.add(0, LEFT, 1000, 1, 0); pops.add(1, RIGHT, 1000, 2, 0);
    expect(frame(pops, 1000).sort()).toEqual(['+1', '+2']);
  });
  it('holds back a pop that would cover a young neighbour, then shows it with everything since', () => {
    const pops = new PayoutPops();
    pops.add(0, LEFT, 1000, 1, 0); frame(pops, 1000);
    pops.add(1, NEXT, 1100, 2, 0);
    expect(frame(pops, 1100)).toEqual(['+1']);
    pops.add(1, NEXT, 1300, 3, 0);
    expect(frame(pops, 1500 + 10)).toEqual(['+1', '+5']);
  });
  it('drops completions older than a pop life and skips sub-unit payouts', () => {
    const pops = new PayoutPops();
    pops.add(0, LEFT, 0, 5, 0); pops.add(1, RIGHT, 2000, 0.4, 0.3);
    expect(frame(pops, POP_LIFE_MS + 1000)).toEqual([]);
    expect(pops.waiting).toBe(0);
  });
  it('places a completion at its tick and fraction, or in the snapshot\'s last tick without one', () => {
    const c = { tau: 0.5 } as Completion;
    expect(completionMs({ ...c, tick: 12 }, 40)).toBe(1250);
    expect(completionMs(c, 40)).toBe(3950);
  });
});
