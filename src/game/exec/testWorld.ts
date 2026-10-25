import { LINK_COMPILED, type CompiledBuffers } from '../core/buffers';
import { DT_S, MAX_ACCELS } from '../core/constants';
import { LOC } from '../core/buffers';
import { allocRecord, frontList, pushBack } from '../core/pool';
import { initialHot } from '../core/state';
import { ensureRows } from '../core/table';
import { syncHotSizes } from '../core/topology';
import type { World } from '../core/world';
import { FAMILIES, payoutAt } from '../market/families';

import { linkPhase } from '../net/links';
import { routePhase } from '../net/hops';
import { buildState, type FleetSpec } from '../testkit/builders';
import type { GameState } from '../types/state';
import { admitPhase } from './admit';
import { runPhase } from './run';

/**
 * Test fixtures for exec and net (not imported by the sim). Capability columns are written here,
 * so tests pin exactly the hardware they reason about. Install TEST_FAMILIES with
 * `vi.mock('../market/families', ...)` before using these.
 */
export interface Caps {
  readonly threads: number; readonly cores: number; readonly K: number; readonly Q: number; readonly strategy: number;
  readonly threadRate: number; readonly memCap: number; readonly hasRam: number; readonly ramBw: number;
  readonly gpuOps: number; readonly vram: number; readonly storageCap: number; readonly ioRate: number; readonly ioConc: number; readonly ecc: number;
  /** The lone system's pipe in bit/s. Infinity lands transfers at the τ they start, isolating execution tests from transfer time. */
  readonly pipeSpeed: number;
}
export interface AccelCaps {
  readonly kind?: 'gpu' | 'npu'; readonly cores: number; readonly ops: number; readonly vram: number;
  readonly tensorOps?: number; readonly idleW?: number; readonly loadW?: number;
}

/** Explicit physical cards for paired-capacity and execution tests. */
export function setAccels(c: CompiledBuffers, s: number, cards: readonly AccelCaps[], linked = false): void {
  const a = c.sys;
  a.gpuLinked[s] = linked ? 1 : 0;
  a.gpuOps[s] = 0; a.tensorOps[s] = 0; a.vram[s] = 0; a.npu[s] = 0;
  for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
    const p = s * MAX_ACCELS + slot, card = cards[slot], gpu = card?.kind !== 'npu';
    a.accelKind[p] = card ? gpu ? 1 : 2 : 0;
    a.accelCores[p] = card && gpu ? card.cores : 0;
    a.accelClockHz[p] = card && gpu ? card.ops / card.cores : 0;
    a.accelOps[p] = card && gpu ? card.ops : 0;
    a.accelTensorOps[p] = card?.tensorOps ?? (gpu ? card?.ops ?? 0 : 0);
    a.accelVram[p] = card?.vram ?? 0;
    a.accelIdleW[p] = card?.idleW ?? 0; a.accelLoadW[p] = card?.loadW ?? 0;
    if (!card) continue;
    if (gpu) { a.gpuOps[s] = a.gpuOps[s]! + card.ops; a.vram[s] = a.vram[s]! + card.vram; }
    else a.npu[s] = a.npu[s]! + 1;
    a.tensorOps[s] = a.tensorOps[s]! + a.accelTensorOps[p]!;
  }
}
export const CAPS: Caps = {
  threads: 1, cores: 1, K: 1, Q: 0, strategy: 0, threadRate: 1, memCap: 1024, hasRam: 1, ramBw: 1,
  gpuOps: 1, vram: 16, storageCap: 16, ioRate: 1, ioConc: 1, ecc: 0, pipeSpeed: Infinity,
};

export function setCaps(c: CompiledBuffers, s: number, caps: Partial<Caps>): void {
  const all = { ...CAPS, ...caps };
  const sys = c.sys;
  sys.threads[s] = all.threads; sys.cores[s] = all.cores; sys.K[s] = all.K; sys.Q[s] = all.Q; sys.strategy[s] = all.strategy;
  const keff = all.strategy === 2 ? 2 * all.K : Math.min(all.K, all.threads);
  sys.keff[s] = keff; sys.slots[s] = keff + all.Q;
  sys.threadRate[s] = all.threadRate; sys.memCap[s] = all.memCap; sys.cacheBits[s] = all.memCap; sys.hasRam[s] = all.hasRam;
  sys.ramBw[s] = all.ramBw; sys.gpuOps[s] = all.gpuOps; sys.tensorOps[s] = 0; sys.npu[s] = 0;
  sys.vram[s] = all.vram; sys.storageCap[s] = all.storageCap; sys.ioRate[s] = all.ioRate; sys.ioConc[s] = all.ioConc;
  sys.ecc[s] = all.ecc; sys.etaCfg[s] = 1; sys.kind[s] = 0; sys.pipeSpeed[s] = all.pipeSpeed;
  setAccels(c, s, all.gpuOps > 0 ? [{ cores: 1, ops: all.gpuOps, vram: all.vram }] : []);
}

/** Appends a link row; returns its id. */
export function addLink(c: CompiledBuffers, kind: number, owner: number, speed: number, channels = 1, latencyTicks = 0): number {
  const l = c.link.len;
  ensureRows(LINK_COMPILED, c.link, l + 1);
  c.link.kind[l] = kind; c.link.owner[l] = owner; c.link.speed[l] = speed; c.link.channels[l] = channels; c.link.latencyTicks[l] = latencyTicks;
  return l;
}

/** A running-round state with every system at `caps`; `edit` may change compiled further (links, routers). */
export function execState(spec: Partial<FleetSpec> = {}, caps: Partial<Caps> = {}, edit?: (c: CompiledBuffers) => void): GameState {
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, round: 'running', seed: 7, ...spec });
  const c = base.compiled;
  for (let s = 0; s < c.sys.len; s += 1) if (c.sys.alive[s] === 1) setCaps(c, s, caps);
  edit?.(c);
  const hot = initialHot(base);
  syncHotSizes(hot, c);
  // No window: tests feed exact work at the queue front (feed), so no drawn task joins in.
  return { ...base, hot, market: { ...base.market, window: [] } };
}

/**
 * Puts a cohort of `count` tasks of `family` at per-member size `scale` at the queue front, where
 * returned work waits ahead of the window: it is the head until taken.
 */
export function feed(w: World, family: number, count: number, scale: number): number {
  const r = allocRecord(w.hot);
  const rec = w.hot.rec;
  rec.family[r] = family; rec.count[r] = count; rec.stage[r] = 0; rec.scale[r] = scale;
  rec.payout[r] = payoutAt(FAMILIES[family]!, scale);
  rec.threads[r] = FAMILIES[family]!.threads;
  rec.taskId[r] = w.hot.g[4]!;
  w.hot.g[4] = w.hot.g[4]! + count;
  rec.loc[r] = LOC.front;
  pushBack(w.hot, frontList(w.hot), r);
  w.market.headTick = w.tick;
  return r;
}

/** S3's phases for one tick, plus phys's effClock advance (R16). Tallies accumulate (no events phase). */
export function step(w: World): void {
  linkPhase(w);
  routePhase(w);
  admitPhase(w);
  runPhase(w);
  const h = w.hot.rack;
  for (let r = 0; r < h.len; r += 1) h.effClock[r] = h.effClock[r]! + h.eff[r]! * DT_S;
  w.tick += 1;
}

export function steps(w: World, n: number, each?: (w: World) => void): void {
  for (let i = 0; i < n; i += 1) { step(w); each?.(w); }
}

/** Met tasks of `family` tallied so far (no events phase in `step`). */
export const metOf = (w: World, family: number): number => w.hot.fam.metTick[family]!;
export const failedOf = (w: World, family: number, cause: number): number => w.hot.fam.failTick[family * 6 + cause]!;
