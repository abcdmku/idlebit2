import { accelNeed } from '../core/accelerators';
import { SERVERS_PER_RACK } from '../core/constants';
import { dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import type { CompiledBuffers } from '../core/buffers';
import { hasRule } from './rules';
import { CPU, GPU, IO, RAM, shapeOf, stageWorkAt, workingSetOf, type Shape } from './shape';

/**
 * The memory hierarchy (D26.1, spec §6.5). A system's tiers are cache, RAM and disk (its drives, then
 * the rack storage node's with sharedStorage, `diskNode`). At start a shard's working set is placed
 * fastest tier first in free capacity and held, fixed, until it completes or is lost: record columns
 * memC, memR, memD (memN of memD on the node). Its mem stages then run in parts by frozen traffic
 * fractions trafR, trafD (D26.2; hotPages squares the disk share). With unifiedMemory a VRAM need
 * above the card's free VRAM is placed in free RAM, then on disk (vramR, vramD, vramN; D26.4).
 */

/** Stage parts (rec.part): the stage's own resource, then its RAM part, then its disk part. */
export const PART_MAIN = 0;
export const PART_RAM = 1;
export const PART_DISK = 2;

const nodeOf = (w: World, s: number): number => w.compiled.sys.diskNode[s]!;
export const freeCache = (w: World, s: number): number => Math.max(0, w.compiled.sys.cacheBits[s]! - w.hot.sys.usedCache[s]!);
export const freeRam = (w: World, s: number): number => Math.max(0, w.compiled.sys.ramCap[s]! - w.hot.sys.usedRam[s]!);
export const freeLocalDisk = (w: World, s: number): number => Math.max(0, w.compiled.sys.storageCap[s]! - w.hot.sys.usedDisk[s]!);
export function freeNodeDisk(w: World, s: number): number {
  const n = nodeOf(w, s);
  return n < 0 ? 0 : Math.max(0, w.compiled.sys.storageCap[n]! - w.hot.sys.usedDisk[n]!);
}
export const freeDisk = (w: World, s: number): number => freeLocalDisk(w, s) + freeNodeDisk(w, s);
/** The free hierarchy: cache + RAM + disk not held by running shards (D26.1). */
export const freeHierarchy = (w: World, s: number): number => freeCache(w, s) + freeRam(w, s) + freeDisk(w, s);

/** The disk tier's IO, bit/s: Σ own drives plus the storage node's drives (striping, spec §6.2). */
export function diskRate(w: World, s: number): number {
  const c = w.compiled.sys, n = c.diskNode[s]!;
  return c.ioRate[s]! + (n >= 0 ? c.ioRate[n]! : 0);
}

/**
 * Room outside VRAM for a starting shard's VRAM overflow (unifiedMemory, D26.4): the free RAM and disk
 * left after its working set `ws` is placed. 0 without the rule.
 */
export function unifiedRoom(w: World, s: number, ws: number): number {
  if (!hasRule(w, 'unifiedMemory')) return 0;
  const below = Math.max(0, ws - freeCache(w, s));
  return Math.max(0, freeRam(w, s) + freeDisk(w, s) - below);
}

/** Splits `bits` over free RAM, local disk, then the node: [ram, disk, node] (node ⊂ disk). */
const spot = new Float64Array(3);
function spill(w: World, s: number, bits: number): Float64Array {
  const r = Math.min(bits, freeRam(w, s));
  const dl = Math.min(bits - r, freeLocalDisk(w, s));
  const dn = Math.max(0, bits - r - dl);
  spot[0] = r; spot[1] = dl + dn; spot[2] = dn;
  return spot;
}

function hold(w: World, s: number, cache: number, ram: number, disk: number, node: number): void {
  const h = w.hot.sys, n = nodeOf(w, s);
  h.usedCache[s] = h.usedCache[s]! + cache;
  h.usedRam[s] = h.usedRam[s]! + ram;
  h.usedDisk[s] = h.usedDisk[s]! + (disk - node);
  if (node > 0 && n >= 0) h.usedDisk[n] = h.usedDisk[n]! + node;
}

/**
 * Places record r's working set and VRAM overflow on s (count-1 records; a cohort places per task, so
 * k tasks of one record share one placement). `vramHeld` is the VRAM each task holds on its card.
 */
export function placeRecord(w: World, s: number, r: number, vramHeld: number): void {
  const rec = w.hot.rec, k = rec.count[r]!;
  const shape = shapeOf(rec.family[r]!);
  const ws = workingSetOf(shape, rec.units[r]!);
  const c = Math.min(ws, freeCache(w, s) / k);
  const rest = spill(w, s, (ws - c) * k);
  const ramB = rest[0]! / k, diskB = rest[1]! / k, nodeB = rest[2]! / k;
  rec.memC[r] = c; rec.memR[r] = ramB; rec.memD[r] = diskB; rec.memN[r] = nodeB;
  rec.flags[r] = rec.flags[r]! | PLACED;
  hold(w, s, c * k, ramB * k, diskB * k, nodeB * k);
  const fr = ws > 0 ? ramB / ws : 0, fd = ws > 0 ? diskB / ws : 0;
  if (fd > 0 && hasRule(w, 'hotPages')) {
    // D26.3: hot data stays in fast tiers. The rest of the disk share goes to RAM, or cache without RAM.
    rec.trafD[r] = fd * fd;
    rec.trafR[r] = w.compiled.sys.hasRam[s] === 1 ? fr + fd - fd * fd : fr;
  } else { rec.trafR[r] = fr; rec.trafD[r] = fd; }
  const need = accelNeed(shape.def, rec.units[r]!).vramBits;
  const over = Math.max(0, need - vramHeld);
  if (over > 0) {
    const v = spill(w, s, over * k);
    rec.vramR[r] = v[0]! / k; rec.vramD[r] = v[1]! / k; rec.vramN[r] = v[2]! / k;
    hold(w, s, 0, v[0]!, v[1]!, v[2]!);
  } else { rec.vramR[r] = 0; rec.vramD[r] = 0; rec.vramN[r] = 0; }
  // D26.5: the late detail is the slowest tier any shard's traffic touched.
  const p = rec.parent[r]!;
  if (p >= 0) {
    tierTraffic(w, r, traffic);
    const tier = traffic[1]! > 0 ? 2 : traffic[0]! > 0 ? 1 : 0;
    if (tier > w.hot.parent.tier[p]!) w.hot.parent.tier[p] = tier;
  }
}
const traffic = new Float64Array(2);
/** rec.flags bit: the record holds a placement (released once). */
const PLACED = 1;

/** Gives back what placeRecord held, once. A storage-node release wakes the rack's other servers. */
export function releaseMemory(w: World, s: number, r: number): void {
  const rec = w.hot.rec, h = w.hot.sys, k = rec.count[r]!, n = nodeOf(w, s);
  if ((rec.flags[r]! & PLACED) === 0) return;
  rec.flags[r] = rec.flags[r]! & ~PLACED;
  const node = (rec.memN[r]! + rec.vramN[r]!) * k;
  h.usedCache[s] = Math.max(0, h.usedCache[s]! - rec.memC[r]! * k);
  h.usedRam[s] = Math.max(0, h.usedRam[s]! - (rec.memR[r]! + rec.vramR[r]!) * k);
  h.usedDisk[s] = Math.max(0, h.usedDisk[s]! - (rec.memD[r]! + rec.vramD[r]!) * k + node);
  if (node > 0 && n >= 0) {
    h.usedDisk[n] = Math.max(0, h.usedDisk[n]! - node);
    const rack = w.compiled.sys.rack[s]!;
    for (let i = 0; i < SERVERS_PER_RACK; i += 1) {
      const o = w.compiled.rack.servers[rack * SERVERS_PER_RACK + i]!;
      if (o >= 0 && o !== s) dirtySystem(w, o);
    }
  }
  // The traffic fractions and VRAM overflow stay: completion reads them for the spill sums (outcome.ts).
  rec.memC[r] = 0; rec.memR[r] = 0; rec.memD[r] = 0; rec.memN[r] = 0; rec.vramN[r] = 0;
}

/** The clock a stage part runs on: a mem stage's main part (the free cache part) is a zero-work CPU step. */
export function partClock(shape: Shape, stage: number, part: number): number {
  if (part === PART_RAM) return RAM;
  if (part === PART_DISK) return IO;
  const res = shape.res[stage]!;
  return res === RAM ? CPU : res;
}

/** Work of record r's stage part per task: ops, or bits touched in that tier (D26.2, D26.4). */
export function partWork(w: World, r: number, shape: Shape, stage: number, part: number): number {
  const rec = w.hot.rec, res = shape.res[stage]!;
  const work = stageWorkAt(shape, stage, rec.units[r]!);
  if (part === PART_MAIN) return res === RAM ? 0 : work;
  if (res === RAM) return work * (part === PART_RAM ? rec.trafR[r]! : rec.trafD[r]!);
  if (res === GPU) {
    const need = accelNeed(shape.def, rec.units[r]!).vramBits;
    if (!(need > 0)) return 0;
    return work * (part === PART_RAM ? rec.vramR[r]! : rec.vramD[r]!) / need;
  }
  return 0;
}

/** The first part ≥ `from` of record r's stage with work (mem stages and spilled GPU stages), or -1. A mem stage with no traffic runs its main part. */
export function firstPart(w: World, r: number, shape: Shape, stage: number, from: number): number {
  const res = shape.res[stage]!;
  if (from === PART_MAIN && res !== RAM) return PART_MAIN;
  for (let p = Math.max(PART_RAM, from); p <= PART_DISK; p += 1) if (partWork(w, r, shape, stage, p) > 0) return p;
  return from === PART_MAIN ? PART_MAIN : -1;
}

/** The clock record r is on now. */
export const recordClock = (w: World, r: number): number =>
  partClock(shapeOf(w.hot.rec.family[r]!), w.hot.rec.stage[r]!, w.hot.rec.part[r]!);

/**
 * Bits of record r's whole run (per task) touched in RAM and on disk, for the round's spill sums and
 * the late detail (D26.5, D26.7): Σ over its mem stages and spilled GPU stages.
 */
export function tierTraffic(w: World, r: number, out: Float64Array): Float64Array {
  const shape = shapeOf(w.hot.rec.family[r]!);
  out[0] = 0; out[1] = 0;
  for (let i = 0; i < shape.stages; i += 1) {
    out[0] += partWork(w, r, shape, i, PART_RAM);
    out[1] += partWork(w, r, shape, i, PART_DISK);
  }
  return out;
}

/**
 * Static estimate of a shard's tier traffic fractions on s from capacities alone (est, floor, views):
 * its working set placed fastest first in the empty hierarchy.
 */
export function staticFractions(c: CompiledBuffers, s: number, ws: number, out: Float64Array): Float64Array {
  const sys = c.sys;
  if (!(ws > 0)) { out[0] = 0; out[1] = 0; return out; }
  const cache = Math.min(ws, sys.cacheBits[s]!);
  const ram = Math.min(ws - cache, sys.ramCap[s]!);
  out[0] = ram / ws; out[1] = (ws - cache - ram) / ws;
  return out;
}
