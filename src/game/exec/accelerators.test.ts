import { describe, expect, it, vi } from 'vitest';
import { accelGate, accelNeed } from '../core/accelerators';
import { cloneCompiled, LOC } from '../core/buffers';
import { ACCEL_DOMAINS, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import { openWorld, type World } from '../core/world';
import { systemId } from '../types/ids';
import { accelClockAt, recordAccelClock, releaseAccel } from './accelerators';
import { estOn, estRecord } from './est';
import { dropAllWork, killSubtree } from './kill';
import { abortRecord } from './outcome';
import { reconcileAccelerators } from './reconcile';
import { GPU, shapeOf } from './shape';
import { F, TEST_FAMILIES } from './testFamilies';
import { execState, feed, metOf, setAccels, step, steps, type AccelCaps } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

const world = (cards: readonly AccelCaps[], linked = false, K = 4): World => openWorld(execState({},
  { threads: K, K, Q: 8, threadRate: 1 }, (c) => setAccels(c, 0, cards, linked)));
const card = (ops = 10, vram = 100, cores = 4): AccelCaps => ({ ops, vram, cores });
const gpuWork = (w: World, r: number) => accelClockAt(w, recordAccelClock(w, 0, r), w.hot.rack.effClock[0]!);

describe('physical accelerator assignment and lifetime holds', () => {
  it('uses the slower high-VRAM card instead of borrowing the fast card rate', () => {
    const w = world([card(100, 10), card(1, 100)]);
    const r = feed(w, F.gpu60, 1, 1);
    expect(estOn(w, 0, F.gpu60, 1, 0)).toBe(1);
    step(w);
    expect(w.hot.rec.accelDomain[r]).toBe(1);
    expect(gpuWork(w, r)).toBeCloseTo(0.1, 12);
    expect(estRecord(w, 0, r)).toBeCloseTo(0.9, 12);
    steps(w, 10);
    expect(metOf(w, F.gpu60)).toBe(1);
  });

  it('keeps core and VRAM gates paired and ignores diagnostic aggregate maxima', () => {
    const w = world([card(100, 1, 4), card(1, 100, 1)]);
    const need = { required: true, tensor: false, gpuCores: 4, vramBits: 60 };
    expect(accelGate(w.compiled, 0, need)).toBe(5);
    expect(accelGate(w.compiled, 0, { ...need, gpuCores: 5 })).toBe(4);
    w.compiled.sys.gpuOps[0] = 1e30; w.compiled.sys.vram[0] = 1e30;
    expect(estOn(w, 0, F.gpu60, 1, 0)).toBe(1);
    const slow = world([card(0.001, 100, 4)]);
    expect(accelGate(slow.compiled, 0, accelNeed(TEST_FAMILIES[F.gpu4]!, 1))).toBe(0);
  });

  it('starts independent cards concurrently and splits cohorts by available VRAM', () => {
    const w = world([card(10), card(5)]);
    feed(w, F.gpu60, 4, 2);
    step(w);
    const rec = w.hot.rec;
    const live = Array.from({ length: rec.len }, (_, r) => r).filter((r) => rec.loc[r] === LOC.running);
    expect(live).toHaveLength(2);
    expect(live.map((r) => rec.count[r])).toEqual([1, 1]);
    expect(live.map((r) => rec.accelDomain[r]).sort()).toEqual([0, 1]);
    expect(w.hot.sys.accelUsedVram.slice(0, 2)).toEqual(new Float64Array([60, 60]));
    for (const r of live) expect(gpuWork(w, r)).toBe(rec.accelDomain[r] === 0 ? 1 : 0.5);
    expect(w.hot.sys.queueLen[0]).toBe(2);
    steps(w, 15);
    expect(metOf(w, F.gpu60)).toBe(4);
    expect(w.hot.sys.usedVram[0]).toBe(0);
  });

  it('runs all eight physical domains and pooled tensor clock 17', () => {
    const cards = Array.from({ length: 8 }, () => card(10, 60));
    const independent = world(cards, false, 8);
    feed(independent, F.gpu60, 8, 10); step(independent);
    for (let d = 0; d < 8; d += 1) {
      expect(independent.hot.sys.accelActive[2 * d]).toBe(1);
      expect(independent.hot.sys.accelUsedVram[d]).toBe(60);
    }
    const linked = world(cards, true);
    feed(linked, F.tensor, 1, 100); step(linked);
    expect(linked.hot.sys.accelActive[17]).toBe(1);
    expect(linked.hot.sys.accelWAnchor[17]! + linked.hot.sys.accelRate[17]! * (linked.hot.rack.effClock[0]! - linked.hot.sys.accelEAnchor[17]!)).toBe(8);
  });

  it('queues the second 60-bit task on a 100-bit card and skips it for a fitting task', () => {
    const w = world([card(10)]);
    feed(w, F.gpu60, 2, 10);
    const small = feed(w, F.gpu, 1, 10);
    step(w);
    expect(w.hot.sys.running[0]).toBe(2);
    expect(w.hot.sys.queueLen[0]).toBe(1);
    expect(w.hot.rec.loc[small]).toBe(LOC.running);
    expect(w.hot.sys.accelUsedVram[0]).toBe(62);
  });

  it('keeps VRAM through an IO stage and an IO cohort split', () => {
    const w = world([card(100, 200)]);
    w.compiled.sys.ioConc[0] = 1; w.compiled.sys.ioRate[0] = 0.1;
    feed(w, F.gpuIo, 2, 1);
    step(w);
    const h = w.hot.sys, rec = w.hot.rec;
    expect(h.running[0]).toBe(2);
    expect(h.active[GPU]).toBe(0);
    expect(h.accelUsedVram[0]).toBe(120);
    expect(h.accelHolders[0]).toBe(2);
    const live = Array.from({ length: rec.len }, (_, r) => r).filter((r) => rec.loc[r] === LOC.running);
    expect(live).toHaveLength(2);
    expect(live.every((r) => rec.accelDomain[r] === 0 && shapeOf(rec.family[r]!).res[rec.stage[r]!] === 3)).toBe(true);
    abortRecord(w, live[0]!);
    expect(h.accelUsedVram[0]).toBe(60);
    abortRecord(w, live[1]!);
    expect(h.accelHolders[0]).toBe(0);
    expect(h.accelUsedVram[0]).toBe(0);
  });

  it('sums linked GPU products and excludes NPU memory and ordinary throughput', () => {
    const w = world([card(20, 40, 2), card(300, 40, 3), { kind: 'npu', cores: 0, ops: 999, tensorOps: 500, vram: 1000 }], true);
    const r = feed(w, F.gpu60, 1, 64);
    expect(estOn(w, 0, F.gpu60, 64, 0)).toBe(0.2);
    step(w);
    expect(w.hot.rec.accelDomain[r]).toBe(POOL_DOMAIN);
    expect(gpuWork(w, r)).toBe(32);
    expect(w.hot.sys.accelUsedVram[POOL_DOMAIN]).toBe(60);
    expect(accelGate(w.compiled, 0, { required: true, tensor: false, gpuCores: 1, vramBits: 81 })).toBe(5);
  });

  it('runs zero-core tensor work on NPUs but cannot invent GPU cores or ordinary capacity', () => {
    const w = world([{ kind: 'npu', cores: 0, ops: 0, tensorOps: 100, vram: 100 }]);
    expect(accelGate(w.compiled, 0, accelNeed(TEST_FAMILIES[F.gpu]!, 1))).toBe(3);
    expect(accelGate(w.compiled, 0, accelNeed(TEST_FAMILIES[F.tensorCores]!, 1))).toBe(4);
    feed(w, F.tensor, 1, 5);
    step(w);
    expect(metOf(w, F.tensor)).toBe(1);
    expect(w.hot.sys.accelTaskS[0]).toBeCloseTo(0.05, 12);
  });
});

describe('accelerator stage events and recompiles', () => {
  it('immediately shares with a CPU-to-GPU entrant at half a tick', () => {
    const w = world([card(10)]);
    const incumbent = feed(w, F.gpu, 1, 10);
    const entrant = feed(w, F.cpuGpu, 1, 0.05);
    step(w);
    // Incumbent: .05*10 + .01*5 + .04*10 = .95. Entrant finishes at .06.
    expect(gpuWork(w, incumbent)).toBeCloseTo(0.95, 12);
    expect(metOf(w, F.cpuGpu)).toBe(1);
    expect(w.hot.rec.loc[entrant]).toBe(LOC.free);
    expect(w.hot.sys.accelTaskS[0]).toBeCloseTo(0.1, 12);
  });

  it('shares one time budget between ordinary and tensor clocks', () => {
    const w = world([{ ...card(10), tensorOps: 100 }]);
    const plain = feed(w, F.gpu, 1, 10), tensor = feed(w, F.tensor, 1, 10);
    step(w);
    expect(gpuWork(w, plain)).toBeCloseTo(0.5, 12);
    expect(gpuWork(w, tensor)).toBeCloseTo(5, 12);
    expect(w.hot.sys.accelTaskS[0]).toBeCloseTo(0.1, 12);
    expect(w.hot.sys.head[GPU]).toBe(-1);
    expect(w.hot.sys.rate[GPU]).toBe(0);
    expect(w.hot.sys.due[GPU]).toBe(Infinity);
  });

  it('uses core minima as compatibility gates while concurrent tasks share the card', () => {
    const w = world([card(10, 100, 4)]);
    const r = feed(w, F.gpu4, 2, 10);
    step(w);
    expect(w.hot.sys.running[0]).toBe(2);
    expect(w.hot.rec.count[r]).toBe(1); // each take is one task (spec §6.4)
    expect(w.hot.sys.accelActive[0]).toBe(2);
    expect(gpuWork(w, r)).toBe(0.5);
  });

  it('chains short same-card tasks inside the tick without spending earlier work', () => {
    const w = world([card(10)], false, 1);
    feed(w, F.gpu, 5, 0.15);
    step(w);
    expect(metOf(w, F.gpu)).toBe(5);
    expect(w.hot.sys.accelTaskS[0]).toBeCloseTo(0.075, 12);
    expect(w.hot.sys.usedVram[0]).toBe(0);
  });

  it('hot upgrades preserve progress and reservations while changing future speed', () => {
    const w = world([card(10, 100)]);
    const r = feed(w, F.gpu60, 1, 10);
    step(w);
    const old = w.compiled, beforeFinish = w.hot.rec.finish[r]!;
    w.compiled = cloneCompiled(old); setAccels(w.compiled, 0, [card(20, 200)]);
    reconcileAccelerators(w, old);
    expect(w.hot.rec.finish[r]).toBe(beforeFinish);
    expect(gpuWork(w, r)).toBe(1);
    expect(w.hot.sys.accelUsedVram[0]).toBe(60);
    step(w);
    expect(gpuWork(w, r)).toBeCloseTo(3, 12);
  });

  it('GPU-link conversion preserves GPU and CPU-stage holders, progress and NPU identity', () => {
    const w = world([card(10, 100), card(20, 100), { kind: 'npu', cores: 0, ops: 0, tensorOps: 30, vram: 100 }]);
    const gpu = feed(w, F.gpu60, 1, 10), cpu = feed(w, F.cpuGpu, 1, 10), npu = feed(w, F.tensor, 1, 10);
    step(w);
    const rec = w.hot.rec, before = rec.finish[gpu]! - gpuWork(w, gpu), cpuFinish = rec.finish[cpu]!;
    const old = w.compiled;
    w.compiled = cloneCompiled(old); w.compiled.sys.gpuLinked[0] = 1;
    reconcileAccelerators(w, old);
    expect(rec.accelDomain[gpu]).toBe(POOL_DOMAIN);
    expect(rec.accelDomain[cpu]).toBe(POOL_DOMAIN);
    expect(rec.accelDomain[npu]).toBe(2);
    expect(rec.finish[gpu]! - gpuWork(w, gpu)).toBe(before);
    expect(rec.start[gpu]).toBeCloseTo(-2, 12);
    expect(rec.finish[cpu]).toBe(cpuFinish);
    expect(w.hot.sys.accelUsedVram[POOL_DOMAIN]).toBe(62);
    expect(w.hot.sys.accelHolders[POOL_DOMAIN]).toBe(2);
    expect(w.hot.sys.accelUsedVram[0]).toBe(0);
    expect(w.hot.sys.accelUsedVram[1]).toBe(0);
    step(w);
    expect(gpuWork(w, gpu)).toBeCloseTo(3, 12);
  });

  for (const cause of ['power', 'heat', 'swap', 'offline'] as const) {
    it(`releases every domain on ${cause}, retaining consumed duty`, () => {
      const w = world([card(), card(5)]);
      feed(w, F.gpu60, 2, 10); feed(w, F.cpuGpu, 1, 10);
      step(w);
      const used = w.hot.sys.accelTaskS.slice(0, MAX_ACCELS);
      killSubtree(w, { kind: 'system', id: systemId(0) }, cause === 'offline' ? 'swap' : cause);
      expect(w.hot.sys.accelUsedVram.slice(0, ACCEL_DOMAINS)).toEqual(new Float64Array(ACCEL_DOMAINS));
      expect(w.hot.sys.accelHolders.slice(0, ACCEL_DOMAINS)).toEqual(new Uint16Array(ACCEL_DOMAINS));
      expect(w.hot.sys.accelHead.slice(0, 18)).toEqual(new Int32Array(18).fill(-1));
      expect(w.hot.sys.accelTaskS.slice(0, MAX_ACCELS)).toEqual(used);
      expect(w.hot.sys.running[0]).toBe(0);
    });
  }

  it('round end clears reservations and clocks and release is idempotent', () => {
    const w = world([card()]);
    const r = feed(w, F.gpu60, 1, 10);
    step(w);
    abortRecord(w, r); releaseAccel(w, 0, r);
    expect(w.hot.sys.usedVram[0]).toBe(0);
    feed(w, F.gpu60, 2, 10); step(w);
    dropAllWork(w);
    expect(w.hot.sys.usedVram[0]).toBe(0);
    expect(w.hot.sys.accelHolders.every((k) => k === 0)).toBe(true);
    expect(w.hot.sys.accelRate.every((k) => k === 0)).toBe(true);
  });
});
