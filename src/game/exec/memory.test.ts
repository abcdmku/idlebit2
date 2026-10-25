import { describe, expect, it, vi } from 'vitest';
import { G, LOC, type CompiledBuffers } from '../core/buffers';
import { rqLen, rqRow } from '../core/routerQueue';
import { openWorld, type World } from '../core/world';
import { canRunFleet, canRunOn, detailIndex } from '../market/fleet';
import { FAMILIES } from '../market/families';
import { FAIL_DETAILS } from '../types/events';
import { CAUSE } from './outcome';
import { F } from './testFamilies';
import { execState, failedOf, feed, metOf, step, steps, type Caps } from './testWorld';
import type { FleetSpec } from '../testkit/builders';
import type { RuleId } from '../types/catalog';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

/** D26 mechanics on hand-pinned hardware (testWorld: memCap is the RAM tier, cache 0 unless set). */

const fastLinks = (c: CompiledBuffers) => { for (let l = 0; l < c.link.len; l += 1) c.link.speed[l] = 1e15; };
const world = (spec: Partial<FleetSpec>, caps: Partial<Caps>, edit?: (c: CompiledBuffers) => void): World =>
  openWorld(execState(spec, caps, (c) => { fastLinks(c); edit?.(c); }));
const rack = (n: number, caps: Partial<Caps>, edit?: (c: CompiledBuffers) => void): World => world({
  serversPerRack: n, rack: (r) => ({ ...r, switch: { ...r.switch, ports: Array(n).fill(r.switch.ports[0] ?? 0) } }),
}, caps, edit);
const grant = (w: World, ...rules: RuleId[]) => { w.research.unlocks = { ...w.research.unlocks, rules: [...w.research.unlocks.rules, ...rules] }; };

/** The tick in which `family`'s first task is met, stepping at most `limit` ticks; -1 if never. */
function metTick(w: World, family: number, limit = 400): number {
  for (let i = 0; i < limit; i += 1) { step(w); if (metOf(w, family) > 0) return w.tick - 1; }
  return -1;
}

describe('memory hierarchy and spill (D26.1, D26.2)', () => {
  it('runs a working set 2x RAM in M/2 / ramRate + M/2 / diskRate; without a drive it cannot run (RAM)', () => {
    // 8 units: an 8-bit working set over 4 bits of RAM and a drive; the mem stage touches 8 bits.
    const w = world({}, { memCap: 4, ramBw: 1, storageCap: 64, ioRate: 0.5 });
    const r = feed(w, F.spill, 1, 8);
    step(w);
    expect([w.hot.rec.memC[r], w.hot.rec.memR[r], w.hot.rec.memD[r]]).toEqual([0, 4, 4]);
    // 4 bits at 1 bit/s, then 4 bits at 0.5 bit/s: 12 s, so met in tick 119 (±1).
    const tick = metTick(w, F.spill);
    expect(Math.abs(tick - 119)).toBeLessThanOrEqual(1);
    expect([w.hot.sys.usedRam[0], w.hot.sys.usedDisk[0], w.hot.g[G.ramWork], w.hot.g[G.diskWork]]).toEqual([0, 0, 4, 4]);

    const noDrive = world({}, { memCap: 4, storageCap: 0 });
    const q = feed(noDrive, F.spill, 1, 8);
    expect(FAIL_DETAILS[detailIndex(canRunOn(noDrive, 0, q))]).toBe('ram');
    expect(FAIL_DETAILS[detailIndex(canRunFleet(noDrive, FAMILIES[F.spill]!, 8))]).toBe('ram');
  });

  it('a memory-blocked system never queues more than Q (spec §6.4)', () => {
    // Room for one 4-bit working set: one task runs, the rest wait for memory with 3 running slots free.
    const w = world({}, { K: 4, Q: 2, threads: 4, memCap: 4, storageCap: 0, ramBw: 1 });
    for (let i = 0; i < 10; i += 1) feed(w, F.ram, 1, 1);
    const queued: number[] = [];
    steps(w, 30, () => queued.push(w.hot.sys.queueLen[0]!));
    expect([Math.max(...queued), w.hot.sys.running[0]]).toEqual([2, 1]);
  });

  it('a 4-way split over a rack removes the disk part: every shard fits cache + RAM', () => {
    const whole = world({}, { memCap: 4, storageCap: 64 });
    const r = feed(whole, F.spillPar, 1, 16);
    step(whole);
    expect([whole.hot.rec.memR[r], whole.hot.rec.memD[r]]).toEqual([4, 12]);

    const w = rack(4, { memCap: 4, storageCap: 64 });
    feed(w, F.spillPar, 1, 16);
    steps(w, 3);
    const rec = w.hot.rec, running: number[][] = [];
    for (let i = 0; i < rec.len; i += 1) if (rec.loc[i] === LOC.running) running.push([rec.owner[i]!, rec.units[i]!, rec.memR[i]!, rec.memD[i]!]);
    expect(running.sort((a, b) => a[0]! - b[0]!)).toEqual([[0, 4, 4, 0], [1, 4, 4, 0], [2, 4, 4, 0], [3, 4, 4, 0]]);
  });

  it('with unifiedMemory a VRAM need 2x the card runs, its overflow read at RAM speed; without it the need is a VRAM gate', () => {
    // F.gpu needs 2 bits of VRAM; the card holds 1. G = 8 ops at 1 op/s, then 8 x 1/2 bits at 1 bit/s.
    const caps = { gpuOps: 1, vram: 1, memCap: 64, ramBw: 1 };
    const without = world({}, caps);
    const q = feed(without, F.gpu, 1, 8);
    expect(FAIL_DETAILS[detailIndex(canRunOn(without, 0, q))]).toBe('vram');

    const w = world({}, caps, (c) => { c.sys.unifiedBits[0] = 64 + 16; });
    grant(w, 'unifiedMemory');
    const r = feed(w, F.gpu, 1, 8);
    step(w);
    expect([w.hot.sys.accelUsedVram[0], w.hot.rec.vramR[r], w.hot.sys.usedRam[0]]).toEqual([1, 1, 1]);
    // 8 s on the GPU and 4 s of RAM traffic: met in tick 119 (±1).
    expect(Math.abs(metTick(w, F.gpu) - 119)).toBeLessThanOrEqual(1);
    expect([w.hot.sys.accelUsedVram[0], w.hot.sys.usedRam[0]]).toEqual([0, 0]);
  });
});

describe('completion windows (D26.5)', () => {
  it('a task not met by takeTick + deadline − 1 fails late with its full W and frees everything; router-queue time counts', () => {
    // Two servers busy for 30 s; the windowed task waits in the 1-slot LB queue from its take at tick 0.
    const w = rack(2, { threadRate: 1 }, (c) => { c.rack.lbQueueSlots[0] = 1; });
    feed(w, F.cpu, 1, 300); feed(w, F.cpu, 1, 300);
    const t = feed(w, F.par, 1, 4000);
    w.hot.rec.deadline[t] = 20;
    step(w);
    const row = rqRow(w.hot, 0, 0);
    expect([rqLen(w.hot, row), w.hot.g[G.parentUsed], w.hot.parent.taken[0], w.hot.parent.deadline[0]]).toEqual([1, 1, 0, 20]);
    steps(w, 18);
    expect(failedOf(w, F.par, CAUSE.late)).toBe(0);
    step(w);
    // The end of tick 19 = 0 + 20 − 1: late, with W = 4,000, no pay, its queue share and parent row gone.
    expect([failedOf(w, F.par, CAUSE.late), w.hot.g[G.failWorkTick], metOf(w, F.par), rqLen(w.hot, row), w.hot.g[G.parentUsed]])
      .toEqual([1, 4000, 0, 0, 0]);
    steps(w, 400);
    expect(metOf(w, F.par)).toBe(0);
  });
});
