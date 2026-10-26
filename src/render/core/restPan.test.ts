import { describe, expect, it } from 'vitest';
import { DESKTOP_FRAMING } from './camera';
import { rect } from './geom';
import { RestPan, frameRest, restPan } from './restPan';
import type { LevelRenderer, LevelSnapshot } from './types';

const VP = rect(24, 24, 1248, 608), F = { ...DESKTOP_FRAMING, pipe: { x: 72, y: 168, runY: 192 } };
describe('rest pan (scale floor 2)', () => {
  it('frames a window of a focus too tall for 2, centred on the rest centre, and pans it clamped', () => {
    const pan = new RestPan(), f = rect(0, 0, 200, 400);
    pan.window(f, 300, 150, { x: 100, y: 300 }, 2, { x: 0, y: 46 });
    expect(f).toEqual(rect(0, 225, 200, 150));
    pan.setDragging(true); pan.scrollBy(0, -1000); pan.setDragging(false);
    const g = rect(0, 0, 200, 400); pan.window(g, 300, 150, { x: 100, y: 300 }, 2, { x: 0, y: 46 });
    expect(g.y).toBe(0);
  });
  it('snaps a released pan to the level pitch from the focus edge', () => {
    const pan = new RestPan(), f = rect(0, 0, 200, 400);
    pan.window(f, 300, 150, { x: 100, y: 75 }, 2, { x: 0, y: 46 });
    pan.setDragging(true); pan.scrollBy(0, 60); pan.setDragging(false);
    const g = rect(0, 0, 200, 400); pan.window(g, 300, 150, { x: 100, y: 75 }, 2, { x: 0, y: 46 });
    expect(g.y % 46).toBe(0);
  });
  it('never pans a whole-at-rest level (System), and leaves a fitting focus alone', () => {
    const errors: string[] = [], tall = rect(0, 0, 150, 600), s = { level: 'system' } as LevelSnapshot;
    frameRest({ wholeAtRest: true } as LevelRenderer, s, tall, VP, F, { w: 720, h: 416, scale: 3 }, null, w => errors.push(w));
    expect(restPan.active).toBe(false); expect(tall.h).toBe(600); expect(errors).toEqual(['system rest']);
    const small = rect(0, 0, 100, 100);
    frameRest({} as LevelRenderer, s, small, VP, F, { w: 720, h: 416, scale: 3 }, null, () => {});
    expect(restPan.active).toBe(false); expect(small).toEqual(rect(0, 0, 100, 100));
  });
});

describe('rest pan at the framing scale (panAtRestScale, the CPU)', () => {
  it('keeps N = 3 and pans a focus that fits at 2 but not at 3, instead of dropping the scale', () => {
    const s = { level: 'chip' } as LevelSnapshot, tall = rect(0, 0, 200, 180);
    frameRest({} as LevelRenderer, s, rect(0, 0, 200, 180), VP, F, { w: 720, h: 416, scale: 3 }, null, () => {});
    expect(restPan.active).toBe(false);
    frameRest({ panAtRestScale: true } as LevelRenderer, s, tall, VP, F, { w: 720, h: 416, scale: 3 }, null, () => {});
    expect(restPan.active).toBe(true); expect(restPan.scale).toBe(3); expect(tall.h).toBe(Math.floor(416 / 3)); expect(tall.w).toBe(200);
    restPan.reset();
  });
});
