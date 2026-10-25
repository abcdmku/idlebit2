import { describe, expect, it, vi } from 'vitest';
import { G } from '../core/buffers';
import { openWorld, type World } from '../core/world';
import { F } from './testFamilies';
import { execState, feed, metOf, step, steps, type Caps } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

/** The lone system before Rack, on a 1 kHz pipe (D10.4). Stage work = scale, so payload bits = scale. */
const lone = (caps: Partial<Caps> = {}): World => openWorld(execState({}, { pipeSpeed: 1000, ...caps }));

/** Tick in which `family` reaches `n` met, or -1. */
function tickOf(w: World, family: number, n: number, max = 400): number {
  for (let i = 0; i < max; i += 1) { if (metOf(w, family) >= n) return w.tick - 1; step(w); }
  return -1;
}

describe('the inbound pipe (D10.4, spec §6.4)', () => {
  it('lands a 1,000-op task in 1 s at 1 kHz, one transfer at a time', () => {
    const w = lone({ threadRate: 1e9 });
    feed(w, F.cpu, 1, 1000);
    feed(w, F.cpu, 1, 1);
    steps(w, 5);
    expect(w.hot.sys.pipeLeft[0]).toBeCloseTo(500, 9);
    expect(w.hot.sys.pipeBits[0]).toBeCloseTo(100, 9);
    expect(w.hot.sys.running[0]! + w.hot.sys.queueLen[0]!).toBe(0);
    // The pipe is busy, so the second task is still at the queue front.
    expect(w.hot.g[G.frontLen]).toBe(1);
    // Lands at the end of tick 9; 1 µs of compute then completes in tick 10.
    expect(tickOf(w, F.cpu, 1)).toBe(10);
  });

  it('without a scheduler a task costs transfer + compute; with a queue slot, max(transfer, compute)', () => {
    // 150-bit transfers (0.15 s) and 150-op tasks at 110 ops/s (1.364 s).
    const second = (Q: number) => {
      const w = lone({ threadRate: 110, K: 1, Q });
      feed(w, F.cpu, 2, 150);
      return tickOf(w, F.cpu, 2);
    };
    expect(second(0)).toBe(30); // 0.15 + 1.364 + 0.15 + 1.364 = 3.03 s
    expect(second(1)).toBe(28); // the second transfer overlaps the first task: 0.15 + 2 × 1.364 = 2.88 s
  });

  it('takes at most one task per slot per tick, however short the tasks', () => {
    const w = lone({ threadRate: 1e6, K: 1, Q: 1, pipeSpeed: Infinity });
    feed(w, F.cpu, 6, 0.01);
    step(w);
    expect(w.hot.sys.takes[0]).toBe(2);
    expect(metOf(w, F.cpu)).toBe(2);
    step(w);
    expect(metOf(w, F.cpu)).toBe(4);
  });

  it('a head the system cannot run blocks the line: nothing behind it is taken', () => {
    const w = lone({ memCap: 8, threadRate: 100 });
    feed(w, F.big, 1, 1);
    feed(w, F.cpu, 1, 1);
    steps(w, 20);
    expect(w.hot.g[G.frontLen]).toBe(2);
    expect(metOf(w, F.cpu)).toBe(0);
    w.compiled.sys.memCap[0] = 64;
    expect(tickOf(w, F.cpu, 1)).toBeGreaterThan(19);
  });
});
