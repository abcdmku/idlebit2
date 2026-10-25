import type { CompiledBuffers } from '../core/buffers';
import { RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { FAMILIES, stageWork } from '../market/families';
import type { Resource } from '../types/catalog';

/** Router kinds as net/scope (rack 0, room 1, site 2, global 3); kept local so market/ may use this. */
const RACK = 0, ROOM = 1, SITE = 2, GLOBAL = 3;

/**
 * The split floor (D25.11): a router never cuts a task finer than useful. Every shard carries at
 * least 1 s of work at its target's nominal rate, so n ≤ floor(seconds of the share at the fastest
 * nominal rate below the router). The fastest rate below the whole router is used for every child:
 * the most conservative rate at hand, read from per-compiled maxima, never from live state.
 *
 * D25.11 item 2 (D26.6): the floor never cuts below nNoDisk = ceil(wsPerUnit × u / ((cache + RAM) / Keff − wsFixed)),
 * the split that keeps every shard's working set off disk, nor below the split that fits the whole hierarchy.
 * Both read the subtree's smallest per-slot fast memory and hierarchy (the most conservative values). The
 * callers cap the result at floor(u / ĝ) and 256.
 */

const RES: Readonly<Record<Resource, number>> = { compute: 0, mem: 1, gpu: 2 };
const NRES = 4;

/**
 * Per scope row × resource: the fastest nominal rate (ops/s) of a task-running system below it; per
 * scope row × 2 (`mins`): the smallest (cache + RAM) / Keff and hierarchy (memCap) below it.
 */
interface Maxima { rack: Float64Array; room: Float64Array; site: Float64Array; global: Float64Array; mins: Mins }
interface Mins { rack: Float64Array; room: Float64Array; site: Float64Array; global: Float64Array }
const memo = new WeakMap<CompiledBuffers, Maxima>();

function maximaOf(c: CompiledBuffers): Maxima {
  const hit = memo.get(c);
  if (hit) return hit;
  const m: Maxima = {
    rack: new Float64Array(c.rack.len * NRES), room: new Float64Array(c.room.len * NRES),
    site: new Float64Array(c.site.len * NRES), global: new Float64Array(NRES),
    mins: {
      rack: new Float64Array(c.rack.len * 2).fill(Infinity), room: new Float64Array(c.room.len * 2).fill(Infinity),
      site: new Float64Array(c.site.len * 2).fill(Infinity), global: new Float64Array(2).fill(Infinity),
    },
  };
  const mn = m.mins;
  const low = (a: Float64Array, i: number, b: Float64Array, j: number) => { a[i] = Math.min(a[i]!, b[j]!); a[i + 1] = Math.min(a[i + 1]!, b[j + 1]!); };
  const s = c.sys;
  for (let rack = 0; rack < c.rack.len; rack += 1) {
    for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
      const sys = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
      if (sys < 0 || s.alive[sys] !== 1 || s.kind[sys] !== 0) continue;
      const rates = [s.threadRate[sys]! * Math.max(1, s.threads[sys]!), s.ramBw[sys]!, Math.max(s.gpuOps[sys]!, s.tensorOps[sys]!), s.ioRate[sys]!];
      for (let r = 0; r < NRES; r += 1) m.rack[rack * NRES + r] = Math.max(m.rack[rack * NRES + r]!, rates[r]!);
      mn.rack[rack * 2] = Math.min(mn.rack[rack * 2]!, (s.cacheBits[sys]! + s.ramCap[sys]!) / Math.max(1, s.keff[sys]!));
      mn.rack[rack * 2 + 1] = Math.min(mn.rack[rack * 2 + 1]!, s.memCap[sys]!);
    }
  }
  for (let room = 0; room < c.room.len; room += 1) {
    for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
      const rack = c.room.racks[room * RACKS_PER_ROOM + k]!;
      if (rack >= 0) for (let r = 0; r < NRES; r += 1) m.room[room * NRES + r] = Math.max(m.room[room * NRES + r]!, m.rack[rack * NRES + r]!);
      if (rack >= 0) low(mn.room, room * 2, mn.rack, rack * 2);
    }
    const site = c.room.site[room]!;
    if (site >= 0) for (let r = 0; r < NRES; r += 1) m.site[site * NRES + r] = Math.max(m.site[site * NRES + r]!, m.room[room * NRES + r]!);
    if (site >= 0) low(mn.site, site * 2, mn.room, room * 2);
  }
  for (let site = 0; site < c.site.len; site += 1) {
    for (let r = 0; r < NRES; r += 1) m.global[r] = Math.max(m.global[r]!, m.site[site * NRES + r]!);
    low(mn.global, 0, mn.site, site * 2);
  }
  memo.set(c, m);
  return m;
}

/** The most shards a share of `units` of `family` may be cut into at router (kind, id): at least 1. */
export function floorShards(c: CompiledBuffers, kind: number, id: number, family: number, units: number): number {
  const m = maximaOf(c);
  const rates = kind === RACK ? m.rack : kind === ROOM ? m.room : kind === SITE ? m.site : m.global;
  const base = kind === GLOBAL ? 0 : id * NRES;
  const f = FAMILIES[family]!;
  let seconds = 0;
  for (const stage of f.stages) {
    // A mem stage is timed at RAM bandwidth, its fastest tier with a rate (cache traffic is free).
    const rate = rates[base + RES[stage.resource]]!;
    // A resource no system below has adds no time: fewer shards, never more.
    if (rate > 0) seconds += stageWork(stage, units) / rate;
  }
  let n = Math.max(1, Math.floor(seconds));
  const wsU = f.workingSet.perSize * units;
  if (wsU > 0) {
    const mins = kind === RACK ? m.mins.rack : kind === ROOM ? m.mins.room : kind === SITE ? m.mins.site : m.mins.global;
    const mb = kind === GLOBAL ? 0 : id * 2;
    const fast = mins[mb]! - f.workingSet.fixed, whole = mins[mb + 1]! - f.workingSet.fixed;
    if (fast > 0 && Number.isFinite(fast)) n = Math.max(n, Math.ceil(wsU / fast));
    if (whole > 0 && Number.isFinite(whole)) n = Math.max(n, Math.ceil(wsU / whole));
  }
  return n;
}
