import { ACCEL_CLOCKS } from '../core/constants';
import { viewW } from '../core/constants';
import type { CompiledBuffers, HotBuffers } from '../core/buffers';
import { HOME_TEMP_F, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, REGIONS, SERVERS_PER_RACK, TICK_MS } from '../core/constants';
import { MODE } from '../core/timers';
import type { CoolerBuild, PartLevel, RouterBuild, SupplyBuild, SwitchBuild } from '../types/build';
import { FILTER_IDS, ROUTE_STRATEGY_IDS, type CoolTech, type FilterId } from '../types/catalog';
import { rqAt, rqLen, rqRow } from '../core/routerQueue';
import { familyId } from '../types/ids';
import type { SupplyKind } from '../types/events';
import type { GameState } from '../types/state';
import { UNIT_MODES, type CoolerView, type LbQueueEntryView, type LbView, type PortView, type SupplyView, type UnitMode } from '../types/views';

/** Cooler ΔT (spec §10.5). */
const COOLER_DT_F = 20;
const COOL_TECHS: readonly CoolTech[] = ['air', 'water', 'closedLoop'];
const TICK_S = TICK_MS / 1000;

export const ticksToS = (ticks: number): number => ticks * TICK_S;
export const modeName = (code: number | undefined): UnitMode => UNIT_MODES[code ?? MODE.empty] ?? 'empty';

/** A system's load: busy hardware threads over threads, 0..1. */
export function systemLoad(state: GameState, s: number): number {
  const threads = state.compiled.sys.threads[s] ?? 0;
  return threads > 0 ? Math.min(1, (state.hot.sys.busyThreads[s] ?? 0) / threads) : 0;
}

/** Task usage in core equivalents; compiled cores and threads span every CPU. */
/**
 * Busy fraction of each of a system's first `nCores` cores (CPU 1), read from the threads its running records
 * are bound to (rec.thread0); other busy threads (research holders) fill the lowest free ones. Core i is always core i.
 */
export function coreOccupancy(state: GameState, s: number, nCores: number, tpc: number, busyThreads: number): Float64Array {
  const rec = state.hot.rec, h = state.hot.sys;
  const total = nCores * tpc;
  const used = new Uint8Array(Math.max(1, total));
  const mark = (r: number) => {
    const t0 = rec.thread0[r] ?? -1;
    if (t0 < 0) return;
    const held = (rec.threads[r] ?? 1) * (rec.count[r] ?? 1);
    for (let t = t0; t < t0 + held && t < total; t += 1) used[t] = 1;
  };
  for (let res = 0; res < 4; res += 1) {
    if (res === 2) { for (let a = 0; a < ACCEL_CLOCKS; a += 1) for (let r = h.accelHead[s * ACCEL_CLOCKS + a] ?? -1; r >= 0; r = rec.next[r] ?? -1) mark(r); continue; }
    for (let r = h.head[s * 4 + res] ?? -1; r >= 0; r = rec.next[r] ?? -1) mark(r);
  }
  // Threads busy without a binding (research holders, hand-built states) take the lowest free ones.
  let placed = 0;
  for (let t = 0; t < total; t += 1) placed += used[t]!;
  let rest = Math.max(0, Math.min(total, busyThreads) - placed);
  for (let t = 0; t < total && rest > 0; t += 1) if (!used[t]) { used[t] = 1; rest -= 1; }
  const out = new Float64Array(nCores);
  for (let i = 0; i < nCores; i += 1) { let n = 0; for (let k = 0; k < tpc; k += 1) n += used[i * tpc + k]!; out[i] = n / tpc; }
  return out;
}

export function systemCoreActivity(state: GameState, s: number): { cores: number; busyCores: number; coreBusy: number[] } {
  const c = state.compiled.sys;
  const cores = c.kind[s] === 1 ? 0 : (c.cores[s] ?? 0);
  const threads = c.threads[s] ?? 0;
  const busyThreads = state.hot.sys.busyThreads[s] ?? 0;
  const load = threads > 0 ? Math.max(0, Math.min(1, busyThreads / threads)) : 0;
  // Per core, in core order (a task keeps its core): the rack sled minis draw from this, not from a count.
  const coreBusy = cores > 0 ? Array.from(coreOccupancy(state, s, cores, Math.max(1, Math.round(threads / cores)), busyThreads)) : [];
  return { cores, busyCores: cores * load, coreBusy };
}

/** Modes whose `timer` counts down a boot-time transition (spec §4.3). */
export function systemTimerS(hot: HotBuffers, s: number): number | null {
  const m = hot.sys.mode[s];
  if (m !== MODE.boot && m !== MODE.goingOffline && m !== MODE.cold) return null;
  return ticksToS(hot.sys.timer[s] ?? 0);
}

/**
 * Mode of a container (rack, zone, site): its own failure first (spec §4.3 order), then a boot-time
 * transition read from its probe system (every system below a toggled container shares the
 * transition), then the switch, then the round. Systems inside carry their own exact modes.
 */
export function containerMode(state: GameState, alive: number | undefined, intent: number | undefined, dark: boolean, crashed: boolean, probe = -1): UnitMode {
  if (alive !== 1) return 'empty';
  if (dark) return 'dark';
  if (crashed) return 'crashed';
  if (probe >= 0 && systemTimerS(state.hot, probe) !== null) return modeName(state.hot.sys.mode[probe]);
  if (intent !== 1) return 'offline';
  return state.round.phase === 'running' ? 'onMarket' : 'paused';
}

/** First live system of a rack, or -1. A container's transition timer is read from it (R11). */
export function rackProbe(state: GameState, rack: number): number {
  const c = state.compiled;
  for (let slot = 0; slot < SERVERS_PER_RACK; slot += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + slot] ?? -1;
    if (s >= 0 && c.sys.alive[s] === 1) return s;
  }
  return -1;
}
export function roomProbe(state: GameState, room: number): number {
  const c = state.compiled.room;
  for (let i = 0; i < RACKS_PER_ROOM; i += 1) {
    const r = c.racks[room * RACKS_PER_ROOM + i] ?? -1;
    const s = r >= 0 ? rackProbe(state, r) : -1;
    if (s >= 0) return s;
  }
  return -1;
}
export function siteProbe(state: GameState, site: number): number {
  for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
    const room = state.compiled.site.zones[site * MAX_ZONES_PER_SITE + z] ?? -1;
    const s = room >= 0 ? roomProbe(state, room) : -1;
    if (s >= 0) return s;
  }
  return -1;
}
export const probeTimerS = (state: GameState, probe: number): number | null => (probe >= 0 ? systemTimerS(state.hot, probe) : null);

/** 1-2-5 ladder (spec §7.3): speed(k) = [1, 2, 5][k mod 3] × 10^(3 + floor(k / 3)) bit/s. */
export const ladderHz = (k: number): number => [1, 2, 5][k % 3]! * 10 ** (3 + Math.floor(k / 3));

export interface SupplyNumbers {
  readonly capacityW: number; readonly usage: number; readonly overTicks: number; readonly failed: boolean;
  readonly rebootTicks: number; readonly loss: number; readonly capSwitch: boolean; readonly capFactor: number;
}
export function supplyView(kind: SupplyKind, part: PartLevel, n: SupplyNumbers, energyPrice: number): SupplyView {
  const deliveredW = n.failed ? 0 : n.usage * n.capacityW;
  const lossW = deliveredW * n.loss;
  return {
    kind, generation: part.gen, level: part.level, capacityW: viewW(n.capacityW), deliveredW: viewW(deliveredW), usage: n.failed ? 0 : n.usage,
    overloadS: ticksToS(n.overTicks), failed: n.failed, rebootMs: n.failed ? n.rebootTicks * TICK_MS : null,
    loss: n.loss, lossW: viewW(lossW), capped: n.capSwitch, capFactor: n.capFactor,
    creditsPerMinute: (deliveredW + lossW) * energyPrice * 60,
  };
}

export function psuView(state: GameState, s: number, part: SupplyBuild): SupplyView {
  const c = state.compiled.sys, h = state.hot.sys;
  const rebootTicks = h.psuRebootTicks[s] ?? 0;
  return supplyView('psu', part, {
    capacityW: c.psuCapW[s] ?? 0, usage: h.psuUsage[s] ?? 0, overTicks: h.psuOverTicks[s] ?? 0, failed: rebootTicks > 0,
    rebootTicks, loss: c.psuLoss[s] ?? 0, capSwitch: (c.psuCapSwitch[s] ?? 0) === 1 && part.capped, capFactor: h.capFactor[s] ?? 1,
  }, siteEnergyPrice(state, c.site[s] ?? 0));
}

/** Lump columns shared by racks and rooms. */
interface LumpCompiled { coolerQc: Float64Array; coolerTech: Uint8Array; setpointF: Float64Array; hasSetpoint: Uint8Array; leak: Float64Array }
interface LumpHot { coolerDuty: Float64Array; coolerW: Float64Array; heatW: Float64Array }

/** Teq of a lump (spec §10.5) at the current duty, heat and surroundings. */
export function equilibriumF(qc: number, duty: number, leak: number, heatW: number, surroundF: number): number {
  const gc = (duty * qc) / COOLER_DT_F, gp = (leak * qc) / COOLER_DT_F;
  if (gc + gp <= 0) return surroundF;
  return (heatW + gc * (surroundF - COOLER_DT_F) + gp * surroundF) / (gc + gp);
}

export function coolerView(c: LumpCompiled, h: LumpHot, i: number, part: CoolerBuild, surroundF: number): CoolerView {
  const qc = c.coolerQc[i] ?? 0, duty = h.coolerDuty[i] ?? 0;
  return {
    tech: COOL_TECHS[c.coolerTech[i] ?? 0] ?? 'air', generation: part.gen, level: part.level, duty,
    setpointF: c.hasSetpoint[i] === 1 ? (c.setpointF[i] ?? part.setpointF) : null,
    watts: viewW(h.coolerW[i] ?? 0), capacityW: viewW(qc), equilibriumF: equilibriumF(qc, duty, c.leak[i] ?? 0, h.heatW[i] ?? 0, surroundF),
  };
}

const maskIds = <T extends string>(ids: readonly T[], mask: number): T[] => ids.filter((_, i) => (mask & (1 << i)) !== 0);

/** A router's compiled and hot columns: rack, room, site data plane (dp*) or global. */
export interface RouterCols {
  readonly strategy: number; readonly filters: number; readonly routed: number; readonly last: number;
  /** Router kind (net/scope: rack 0, room 1, site 2, global 3) and id, for its queue. */
  readonly kind: number; readonly id: number;
}

/** The entries of router (kind, id)'s queue, oldest first (D25.7). */
export function lbQueueEntries(state: GameState, kind: number, id: number): LbQueueEntryView[] {
  const hot = state.hot, row = rqRow(hot, kind, id), q = hot.rq, out: LbQueueEntryView[] = [];
  if (row >= q.len) return out;
  for (let i = 0; i < rqLen(hot, row); i += 1) {
    const at = rqAt(hot, row, i), p = q.rqParent[at]!;
    out.push({
      taskId: q.rqTask[at]!, family: familyId(p >= 0 ? hot.parent.family[p]! : q.rqFamily[at]!), units: q.rqUnits[at]!,
      // A windowed whole task waits as a share of all its units (D26.5): still a whole task here.
      shard: p >= 0 && !(hot.parent.placed[p] === 0 && hot.parent.units[p] === q.rqUnits[at]) ? hot.parent.placed[p]! : null, sinceTick: q.rqSince[at]!,
      windowEndTick: p >= 0 && hot.parent.deadline[p]! >= 0 ? hot.parent.taken[p]! + hot.parent.deadline[p]! - 1 : null,
    });
  }
  return out;
}

export function lbView(state: GameState, part: RouterBuild, r: RouterCols): LbView {
  return {
    generation: part.gen, level: part.level,
    strategy: ROUTE_STRATEGY_IDS[r.strategy] ?? part.strategy,
    filters: maskIds<FilterId>(FILTER_IDS, r.filters),
    queue: { slots: part.queueLevel, level: part.queueLevel, entries: lbQueueEntries(state, r.kind, r.id) },
    // TODO(S3): misroutes per router have no hot column yet.
    routedPerSec: r.routed / TICK_S, misroutesThisRound: 0, lastTarget: r.last >= 0 ? r.last : null,
  };
}

/** The port of `link` (or a dead one when -1), with its live transfer. */
export function portView(compiled: CompiledBuffers, hot: HotBuffers, link: number, rung: number, peer: number | null): PortView {
  if (link < 0 || link >= compiled.link.len) {
    return { speedHz: ladderHz(rung), rung, peer, active: false, family: null, progress: 0, queued: 0 };
  }
  const head = hot.link.head[link] ?? -1;
  const speedHz = compiled.link.speed[link] || ladderHz(rung);
  return {
    speedHz, rung: compiled.link.rung[link] ?? rung, peer, active: head >= 0,
    family: head >= 0 ? ((hot.rec.family[head] ?? 0) as PortView['family']) : null,
    // TODO(S3): transfer progress needs the record's link start bit clock (R7 covers stages only).
    progress: 0, queued: Math.max(0, (hot.link.qlen[link] ?? 0) - (head >= 0 ? 1 : 0)),
  };
}

/** Ports and uplinks of a rack or room switch. `peers[p]` is the child slot behind port p. */
export function switchPorts(
  compiled: CompiledBuffers, hot: HotBuffers, sw: SwitchBuild, portLinks: Int32Array, uplinkLinks: Int32Array,
  base: number, upBase: number, peers: readonly (number | null)[],
): { ports: PortView[]; uplinks: PortView[]; topHz: number } {
  let topHz = 0;
  const ports = sw.ports.map((k, p) => {
    const v = portView(compiled, hot, portLinks[base + p] ?? -1, k, peers[p] ?? null);
    topHz = Math.max(topHz, v.speedHz);
    return v;
  });
  const uplinks = sw.uplinks.map((k, u) => portView(compiled, hot, uplinkLinks[upBase + u] ?? -1, k, null));
  // TODO(S5): topHz should be the generation's topK from the ladder catalog, not the fastest installed port.
  return { ports, uplinks, topHz };
}

/** Outside air of a site (spec §3.3). */
export const outsideF = (state: GameState, site: number): number => REGIONS[state.compiled.site.region[site] ?? 0]?.outsideF ?? HOME_TEMP_F;
export const siteEnergyPrice = (state: GameState, site: number): number => REGIONS[state.compiled.site.region[site] ?? 0]?.energyPrice ?? 0;

/** Surroundings of a rack lump: its room's temperature once the room is opened, else home. */
export function rackSurroundF(state: GameState, rack: number): number {
  const room = state.compiled.rack.room[rack] ?? -1;
  return room >= 0 && state.compiled.room.opened[room] === 1 ? (state.hot.room.tempF[room] ?? HOME_TEMP_F) : HOME_TEMP_F;
}
