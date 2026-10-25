import { describe, expect, it, vi } from 'vitest';
import { G } from '../core/buffers';
import { openWorld, type World } from '../core/world';
import { F } from './testFamilies';
import { execState, feed, metOf, step, steps, type Caps } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

const STRAT = { fifo: 0, sjf: 1, timeSlice: 2, priority: 3, mlfq: 4 } as const;
const lone = (caps: Partial<Caps> = {}): World => openWorld(execState({}, caps));

/** Tick at which the tally of `family` first reaches `n`, stepping at most `max` ticks. */
function tickOf(w: World, family: number, n: number, max = 400): number {
  for (let i = 0; i < max; i += 1) { if (metOf(w, family) >= n) return w.tick - 1; step(w); }
  return -1;
}

describe('lone system (before Rack)', () => {
  it('runs one 0.95-op task at 1 op/s and meets it in tick 9', () => {
    const w = lone();
    feed(w, F.cpu, 1, 0.95);
    expect(tickOf(w, F.cpu, 1)).toBe(9);
    expect(w.hot.tally.pay[0]).toBe(0.95);
  });

  it('chains the next task inside the tick (in-tick carry)', () => {
    const w = lone();
    feed(w, F.cpu, 2, 0.24);
    // Both finish by W = 0.48, inside tick 4; starting the second at the next boundary would end in tick 5.
    expect(tickOf(w, F.cpu, 2)).toBe(4);
  });

  it('takes one task at a time without a scheduler, the head first', () => {
    const w = lone();
    feed(w, F.cpu, 1, 0.95);
    feed(w, F.mix, 1, 0.01);
    step(w);
    expect(w.hot.sys.running[0]).toBe(1);
    expect(w.hot.rec.family[w.hot.sys.head[0]!]).toBe(F.cpu);
    expect(w.hot.g[G.frontLen]).toBe(1);
  });

  it('scales compute by η_cfg (D7.5)', () => {
    const w = lone();
    w.compiled.sys.etaCfg[0] = 0.5;
    feed(w, F.cpu, 1, 0.44);
    expect(tickOf(w, F.cpu, 1)).toBe(8);
  });
});

/**
 * A 0.95-op blocker starts first, so the later tasks wait together in the queue (a 1 kHz pipe lands
 * each in under 4 ms) and the strategy decides which starts when the blocker completes in tick 9.
 */
function queuedBehindBlocker(caps: Partial<Caps>, ...tasks: readonly [family: number, scale: number][]): World {
  const w = lone({ pipeSpeed: 1000, ...caps });
  feed(w, F.cpu, 1, 0.95);
  for (const [family, scale] of tasks) feed(w, family, 1, scale);
  return w;
}

describe('system strategies (spec §8.1): each differs from FIFO and orders the queue only', () => {
  it('sjf starts the short task first; fifo the earlier long one', () => {
    const order = (strategy: number) => tickOf(queuedBehindBlocker({ strategy, K: 1, Q: 2 }, [F.cpu, 3.05], [F.cpu2, 0.35]), F.cpu2, 1);
    expect(order(STRAT.fifo)).toBe(43);
    expect(order(STRAT.sjf)).toBe(13);
  });

  it('time slicing admits twice K and shares the core', () => {
    const run = (strategy: number) => {
      const w = lone({ strategy, K: 1, Q: 0 });
      feed(w, F.cpu, 2, 0.95);
      step(w);
      const admitted = w.hot.sys.running[0]! + w.hot.sys.queueLen[0]!;
      return { admitted, first: tickOf(w, F.cpu, 1) };
    };
    expect(run(STRAT.fifo)).toEqual({ admitted: 1, first: 9 });
    expect(run(STRAT.timeSlice)).toEqual({ admitted: 2, first: 18 });
  });

  it('priority starts the highest payout per second first', () => {
    // cpu pays 0.5 per 0.5 s; mix (cpu, ram, io, cpu) pays 4 × 0.3 = 1.2 for 1.2 s of est at rates 1:
    // equal per second, so give mix a slow RAM to make it worse and a big cpu task to make it better.
    const first = (strategy: number) => {
      const w = queuedBehindBlocker({ strategy, K: 1, Q: 4, threads: 1 }, [F.mix, 0.3], [F.cpu, 0.5]);
      w.compiled.sys.ramBw[0] = 0.001;
      steps(w, 10);
      return w.hot.rec.family[w.hot.sys.head[0]!]!;
    };
    expect(first(STRAT.fifo)).toBe(F.mix);
    expect(first(STRAT.priority)).toBe(F.cpu);
  });

  it('mlfq ages: a task queued 3 s starts before a shorter one queued later', () => {
    const pick = (strategy: number) => {
      const w = lone({ strategy, K: 1, Q: 2, pipeSpeed: 1000 });
      feed(w, F.cpu, 1, 4.95);
      feed(w, F.cpu, 1, 0.95);
      steps(w, 30);
      feed(w, F.cpu2, 1, 0.15);
      steps(w, 20);
      return w.hot.rec.family[w.hot.sys.head[0]!]!;
    };
    expect(pick(STRAT.sjf)).toBe(F.cpu2);
    expect(pick(STRAT.mlfq)).toBe(F.cpu);
  });
});

describe('shared resources', () => {
  it('sums working sets against the free hierarchy (D1.1, D26.1)', () => {
    const run = (memCap: number) => {
      // No cache, no drive: the hierarchy is the RAM tier.
      const w = lone({ K: 2, Q: 2, threads: 2, memCap, storageCap: 0 });
      feed(w, F.ram, 2, 0.95);
      step(w);
      return w.hot.sys.running[0];
    };
    expect(run(8)).toBe(2);
    expect(run(6)).toBe(1);
  });

  it('serves one disk part per drive at a time (D1.2)', () => {
    const run = (ioConc: number) => {
      // No cache and no RAM: each working set sits on the drive and its mem stage is a disk part (D26.2).
      const w = lone({ K: 2, Q: 2, threads: 2, ioConc, ioRate: 1, memCap: 0 });
      feed(w, F.io, 2, 0.45);
      return [tickOf(w, F.io, 1), tickOf(w, F.io, 2)];
    };
    expect(run(1)).toEqual([4, 8]);
    expect(run(2)).toEqual([8, 8]);
  });

  it('splits a pooled RAM stage equally', () => {
    const w = lone({ K: 2, Q: 0, threads: 2, ramBw: 2 });
    feed(w, F.ram, 2, 0.95);
    expect(tickOf(w, F.ram, 2)).toBe(9);
  });
});

describe('work stealing (spec §6.5)', () => {
  it('free threads join a running shard short of floor(units / grain) threads', () => {
    const run = (rules: string[]) => {
      const w = lone({ threads: 2, K: 2, Q: 2 });
      w.research.unlocks = { ...w.research.unlocks, rules: rules as never };
      feed(w, F.cpu, 1, 0.15);
      // Grain 1: a 4-unit task wants 4 threads; it starts on the one left free.
      feed(w, F.cpu4, 1, 4);
      return tickOf(w, F.cpu4, 1);
    };
    expect([run([]), run(['workStealing'])]).toEqual([39, 20]);
  });
});
