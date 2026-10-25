import { describe, expect, it, vi } from 'vitest';
import { DT_S } from '../core/constants';
import { LOC } from '../core/buffers';
import { openWorld } from '../core/world';
import { oracleTask, oracleTick, type OracleSystem } from '../testkit/oracle';
import type { Resource } from '../types/catalog';
import { F, TEST_FAMILIES } from './testFamilies';
import { execState, feed, metOf, setAccels, step, type AccelCaps, type Caps } from './testWorld';
import { accelClockAt, recordAccelClock } from './accelerators';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

/**
 * Independent remaining-work oracle. CPU/RAM/IO shares stay fixed per tick; physical GPU
 * domains share at stage events, retain lifetime VRAM and pair capacity with each card's rate.
 * Randomized mixes compare per-tick completions and each live GPU task's remaining work.
 */

interface Task { id: number; family: number; scale: number; stage: number; remaining: number; threads: number; hold: boolean; domain: number }
interface Sys { caps: Caps; timeSlice: boolean; feed: Task[]; queue: Task[]; running: Task[]; cards?: readonly AccelCaps[]; linked?: boolean }

const RES: Record<Resource, number> = { cpu: 0, ram: 1, gpu: 2, io: 3 };
const famOf = (t: Task) => TEST_FAMILIES[t.family]!;
const resOf = (t: Task) => RES[famOf(t).stages[t.stage]!.resource];
const wsOf = (t: Task) => famOf(t).workingSet.fixed;
const keffOf = (s: Sys) => (s.timeSlice ? 2 * s.caps.K : Math.min(s.caps.K, s.caps.threads));

function refTick(s: Sys, metByFamily: number[]): void {
  const c = s.caps;
  const physical = s.cards ?? [{ cores: 1, ops: c.gpuOps, vram: c.vram }];
  const domains = physical.map((card, domain) => ({ ...card, domain }));
  if (s.linked) {
    const gpus = physical.filter((card) => card.kind !== 'npu');
    domains.push({ domain: 8, cores: gpus.reduce((v, card) => v + card.cores, 0),
      vram: gpus.reduce((v, card) => v + card.vram, 0), ops: gpus.reduce((v, card) => v + card.ops, 0),
      tensorOps: gpus.reduce((v, card) => v + (card.tensorOps ?? card.ops), 0) });
  }
  const choice = (t: Task) => {
    const f = famOf(t);
    if (!f.stages.some((stage) => stage.resource === 'gpu')) return -1;
    const bytes = f.vramBits.fixed + f.vramBits.perSize * t.scale;
    let best = -2, speed = -1;
    for (const d of domains) {
      if (s.linked && d.kind !== 'npu' && d.domain !== 8 || d.kind === 'npu' && !f.tensor || d.cores < f.gpuCoresMin) continue;
      const rate = f.tensor ? d.tensorOps ?? d.ops : d.ops;
      const held = s.running.filter((task) => task.domain === d.domain).reduce((v, task) => v + famOf(task).vramBits.fixed + famOf(task).vramBits.perSize * task.scale, 0);
      if (rate > speed && rate > 0 && d.vram - held >= bytes) { best = d.domain; speed = rate; }
    }
    return best;
  };
  const busy = () => s.running.reduce((n, t) => n + t.threads, 0);
  const mem = () => s.running.reduce((n, t) => n + wsOf(t), 0);
  const holds = () => s.running.filter((t) => resOf(t) === 3 && t.hold).length;
  const enter = (t: Task) => {
    t.remaining = famOf(t).stages[t.stage]!.work.perSize * t.scale;
    t.hold = false;
    t.hold = resOf(t) !== 3 || holds() < c.ioConc;
  };
  // Pull admission (spec §6.4): the head is taken while there is room, at most one take per slot per tick.
  let takes = 0;
  const allocate = () => {
    while (s.queue.length + s.running.length < keffOf(s) + c.Q && takes < keffOf(s) + c.Q && s.feed.length > 0) { s.queue.push(s.feed.shift()!); takes += 1; }
    for (let i = 0; i < s.queue.length && s.running.length < keffOf(s);) {
      const t = s.queue[i]!;
      const free = c.threads - busy();
      const domain = choice(t);
      if ((!s.timeSlice && free <= 0) || mem() + wsOf(t) > c.memCap || domain === -2) { i += 1; continue; }
      s.queue.splice(i, 1);
      t.threads = s.timeSlice ? Math.min(famOf(t).threads, c.threads) : Math.min(famOf(t).threads, free);
      s.running.push(t);
      t.domain = domain;
      enter(t);
    }
  };
  allocate();
  const n = [0, 0, 0, 0];
  let cpuThreads = 0;
  for (const t of s.running) { if (resOf(t) !== 3 || t.hold) n[resOf(t)]! += 1; if (resOf(t) === 0) cpuThreads += t.threads; }
  const perThread = c.threadRate * (s.timeSlice ? Math.min(1, c.threads / Math.max(1, cpuThreads)) : 1);
  const pool = [perThread, c.ramBw / Math.max(1, n[1]!), c.gpuOps / Math.max(1, n[2]!), c.ioRate / Math.max(1, n[3]!)];
  const rateOf = (t: Task) => {
    if (resOf(t) === 2) {
      const d = domains.find((domain) => domain.domain === t.domain)!;
      const rate = famOf(t).tensor ? d.tensorOps ?? d.ops : d.ops;
      return rate / s.running.filter((task) => resOf(task) === 2 && task.domain === t.domain).length;
    }
    return resOf(t) === 0 ? pool[0]! * t.threads : resOf(t) === 3 && !t.hold ? 0 : pool[resOf(t)]!;
  };
  let now = 0;
  for (;;) {
    let next: Task | null = null, dt = Infinity;
    for (const t of s.running) {
      const r = rateOf(t);
      const need = r > 0 ? t.remaining / r : t.remaining <= 0 ? 0 : Infinity;
      if (need < dt) { dt = need; next = t; }
    }
    if (!next || now + dt > DT_S) {
      for (const t of s.running) t.remaining -= rateOf(t) * (DT_S - now);
      return;
    }
    for (const t of s.running) if (t !== next) t.remaining -= rateOf(t) * dt;
    now += dt;
    const wasIo = resOf(next) === 3;
    if (next.stage + 1 < famOf(next).stages.length) { next.stage += 1; enter(next); }
    else {
      s.running.splice(s.running.indexOf(next), 1);
      metByFamily[next.family]! += 1;
      if (!s.timeSlice) allocate();
    }
    if (wasIo) {
      const waiting = s.running.filter((t) => resOf(t) === 3 && !t.hold).sort((a, b) => a.id - b.id);
      for (const t of waiting) if (holds() < c.ioConc) t.hold = true;
    }
  }
}

/** Deterministic LCG for fixture generation (tests only; the sim never draws outside the market). */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

const FAMS = [F.cpu, F.cpu2, F.ram, F.mix, F.gpu, F.io];

function compare(seed: number, timeSlice: boolean, cards?: readonly AccelCaps[], linked = false): void {
  const u = lcg(seed);
  const caps: Caps = {
    threads: 1 + Math.floor(u() * 4), cores: 4, K: 1 + Math.floor(u() * 4), Q: Math.floor(u() * 4), strategy: timeSlice ? 2 : 0,
    threadRate: 0.5 + u() * 3, memCap: 4 + Math.floor(u() * 12), hasRam: 1, ramBw: 0.5 + u() * 3,
    gpuOps: 0.5 + u() * 3, vram: 16, storageCap: 16, ioRate: 0.5 + u() * 3, ioConc: 1 + Math.floor(u() * 2), ecc: 0,
    pipeSpeed: Infinity,
  };
  const w = openWorld(execState({}, caps, cards ? (c) => setAccels(c, 0, cards, linked) : undefined));
  const ref: Sys = { caps, timeSlice, feed: [], queue: [], running: [], cards, linked };
  const families = cards ? [...FAMS, F.gpu60, F.cpuGpu, F.tensor] : FAMS;
  const tasks = 6 + Math.floor(u() * 10);
  for (let i = 0; i < tasks; i += 1) {
    const family = families[Math.floor(u() * families.length)]!;
    const scale = 0.05 + u() * 1.5;
    const r = feed(w, family, 1, scale);
    ref.feed.push({ id: w.hot.rec.taskId[r]!, family, scale, stage: 0, remaining: 0, threads: 0, hold: false, domain: -1 });
  }
  const refMet = TEST_FAMILIES.map(() => 0);
  for (let tick = 0; tick < 400; tick += 1) {
    step(w);
    refTick(ref, refMet);
    const got = families.map((f) => metOf(w, f));
    const want = families.map((f) => refMet[f]!);
    if (got.join() !== want.join()) throw new Error(`seed ${seed} tick ${tick}: exec ${got} oracle ${want}`);
    if (cards) {
      for (const task of ref.running) {
        const rec = w.hot.rec;
        const r = Array.from({ length: rec.len }, (_, i) => i).find((i) => rec.loc[i] === LOC.running && rec.taskId[i] === task.id);
        expect(r, `seed ${seed} tick ${tick} task ${task.id}`).toBeDefined();
        expect(rec.stage[r!]).toBe(task.stage);
        expect(rec.accelDomain[r!]).toBe(task.domain);
        if (resOf(task) === 2) {
          const now = accelClockAt(w, recordAccelClock(w, 0, r!), w.hot.rack.effClock[0]!);
          // Independent subtraction and cumulative clocks differ only by float arithmetic.
          expect(rec.finish[r!]! - now).toBeCloseTo(task.remaining, 9);
        }
      }
    }
  }
  expect(families.reduce((n, f) => n + refMet[f]!, 0)).toBe(tasks);
}

describe('exec matches the clock oracle', () => {
  it('on 60 randomized single-system mixes (FIFO)', () => {
    for (let seed = 1; seed <= 60; seed += 1) compare(seed, false);
  });
  it('on 60 randomized mixes with time slicing', () => {
    for (let seed = 101; seed <= 160; seed += 1) compare(seed, true);
  });

  it('matches independent remaining-work arithmetic on physical GPUs and NPUs, linked and independent', () => {
    const cards = [{ cores: 4, ops: 3, vram: 4 }, { cores: 2, ops: 1, vram: 100 },
      { kind: 'npu', cores: 0, ops: 0, tensorOps: 5, vram: 4 }] as const;
    for (let seed = 201; seed < 221; seed += 1) {
      compare(seed, false, cards, seed % 2 === 0);
      compare(seed + 30, true, cards, seed % 2 === 1);
    }
  });

  it("agrees with testkit/oracle.ts on single-stage tasks admitted together", () => {
    const caps = { threads: 4, K: 4, Q: 0, threadRate: 1.3, ramBw: 2.2, gpuOps: 0.7, ioRate: 1.1, ioConc: 4 };
    const w = openWorld(execState({}, caps));
    const fams = [F.cpu, F.ram, F.gpu, F.ram];
    const scales = [0.37, 0.81, 0.29, 1.13];
    const sys: OracleSystem = { perThreadRate: 1.3, hardwareThreads: 4, ramBw: 2.2, gpuOps: 0.7, ioRate: 1.1, eff: 1, tasks: [] };
    fams.forEach((f, i) => {
      feed(w, f, 1, scales[i]!);
      sys.tasks.push(oracleTask(i, [{ resource: TEST_FAMILIES[f]!.stages[0]!.resource, work: scales[i]! }]));
    });
    const doneAt: number[] = [];
    const families = [...new Set(fams)];
    for (let tick = 0; tick < 30; tick += 1) {
      step(w);
      for (const id of oracleTick(sys, tick)) doneAt[id] = tick;
      const execMet = families.reduce((n, f) => n + metOf(w, f), 0);
      expect(execMet).toBe(doneAt.filter((t) => t !== undefined && t <= tick).length);
    }
    expect(doneAt).toEqual([2, 7, 4, 9]);
  });
});
