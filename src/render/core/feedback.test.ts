import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSnapshot } from '../../game';
import { DESKTOP_FRAMING, camera, fitScale, gutters } from './camera';
import { FAIL_BEAT_S, FLASH_S, Feedback } from './feedback';
import { rect } from './geom';
import { P } from './palette';
import { recordingContext } from './testCanvas';
import { createHitTarget } from './types';
import type { LevelRenderer, LevelSnapshot } from './types';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => vi.restoreAllMocks());
const VP = rect(24, 24, 1392, 708), R1 = { x: 1, y: 1 }, F = { ...DESKTOP_FRAMING, pipe: { x: 72, y: 168, runY: 192 } };

describe('rest framing (A05)', () => {
  it('keeps the desktop gutters: the pipe and its tag left, the callout dock right, the pipe run on top', () => {
    expect(gutters(VP, F)).toEqual({ left: 216, right: 312, top: 48, bottom: 0 });
  });
  it('fits whole at N, else at the largest lower integer scale', () => {
    expect(fitScale(rect(0, 0, 200, 160), VP, F)).toBe(3);
    expect(fitScale(rect(0, 0, 156, 196), VP, F)).toBe(2);
    expect(fitScale(rect(0, 0, 900, 900), VP, F)).toBe(1);
  });
});

describe('feedback', () => {
  const snap = (o: Partial<RenderSnapshot>) => ({ epoch: 1, tick: 10, completions: [], failures: [], ...o }) as unknown as RenderSnapshot;
  const fail = (seq: number) => ({ seq, tick: 9, tau: 0.5, taskId: seq, type: 'compute', family: 0, cause: 'cantRun' });
  it('beats once per new failure at the pipe mouth, never for history', () => {
    const fb = new Feedback(), level = {} as LevelRenderer, red = (nowS: number) => {
      const rec = recordingContext(); fb.drawFailure(rec.g, nowS, F, VP, R1); return rec.fills.some(f => f.c === P.fault);
    };
    fb.reset(snap({ failures: [fail(1)] as never }));
    fb.take(snap({ failures: [fail(1)] as never }), level, 'desktop', 1000, 5, true);
    expect(red(5)).toBe(false);
    fb.take(snap({ failures: [fail(1), fail(2)] as never }), level, 'desktop', 1000, 6, true);
    expect(red(6)).toBe(true); expect(red(6 + FAIL_BEAT_S)).toBe(false);
  });
  it('flashes a part gold for 300 ms when its version rises, after the first look', () => {
    const fb = new Feedback(), t = createHitTarget();
    t.id = 'cache'; t.kind = 'part'; t.rect = rect(10, 10, 20, 8);
    let v = 1;
    const level = { partVersion: () => v } as unknown as LevelRenderer;
    const gold = (nowS: number) => { const rec = recordingContext(); fb.drawFlash(rec.g, nowS, Object.assign(camera(), { s: 3 }), VP, R1); return rec.fills.some(f => f.c === P.gold); };
    fb.parts({ level: 'chip' } as LevelSnapshot, level, [t], 1, 0);
    expect(gold(0)).toBe(false);
    v = 2; fb.parts({ level: 'chip' } as LevelSnapshot, level, [t], 1, 1);
    expect(gold(1.1)).toBe(true); expect(gold(1 + FLASH_S)).toBe(false);
  });
  it('flashes a new child when it appears (a sled in its rack, a rack in its room), keyed by what it drills into', () => {
    const fb = new Feedback(), level = {} as LevelRenderer;
    const child = (id: number, x: number) => { const c = createHitTarget(); c.id = `child${id}`; c.kind = 'child'; c.drill = { level: 'system', id } as never; c.rect = rect(x, 10, 20, 8); return c; };
    const goldAt = (nowS: number) => { const rec = recordingContext(); fb.drawFlash(rec.g, nowS, Object.assign(camera(), { s: 3 }), VP, R1); return rec.fills.filter(f => f.c === P.gold); };
    const one = [child(4, 10)], two = [child(4, 10), child(9, 40)];
    fb.parts({ level: 'rack' } as LevelSnapshot, level, one, 1, 0);
    expect(goldAt(0)).toEqual([]);
    fb.parts({ level: 'rack' } as LevelSnapshot, level, two, 2, 1);
    expect(goldAt(1.1).length).toBeGreaterThan(0);
    // the same children again (even reordered): nothing new, no flash
    fb.parts({ level: 'rack' } as LevelSnapshot, level, [two[1]!, two[0]!], 2, 5);
    expect(goldAt(5.1)).toEqual([]);
  });
});
