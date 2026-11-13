import { LINK_KIND, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import { DT_S, MAX_ACCELS } from '../core/constants';
import { MODE } from '../core/timers';
import { dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import {
  CSTATES, DVFS_CLOCK, DVFS_LOAD, EFF_FLAT_HIGH_F, EFF_LOSS_PER_F, EFF_MIN, PACKAGE_IDLE_FACTOR, S3_FACTOR, THROTTLE_CLOCK,
  THROTTLE_LOAD, TURBO_CLOCK, TURBO_LOAD, TURBO_MAX_F,
} from './constants';
import { SYS_DVFS, SYS_TURBO, type PhysSettings } from './settings';

const CPU = 0, RAM = 1, GPU = 2, IO = 3, R = 4;

/** How a mode draws (spec §4.3, §9.7): nothing, idle only, S3 sleep, or idle plus load. */
export const DRAW_NONE = 0, DRAW_IDLE = 1, DRAW_SLEEP = 2, DRAW_FULL = 3;

export function drawKind(mode: number, researchOn: boolean): number {
  switch (mode) {
    case MODE.onMarket: case MODE.draining: case MODE.goingOffline: return DRAW_FULL;
    case MODE.boot: return DRAW_IDLE;
    case MODE.asleep: return DRAW_SLEEP;
    case MODE.paused: case MODE.offline: return researchOn ? DRAW_FULL : DRAW_NONE;
    default: return DRAW_NONE;
  }
}

/** D38: the CPU's fixed draw before System (W, internal units), billed as energy; the real model takes over at System. */
export const PRE_SYSTEM_CPU_W = 10;

/**
 * Thermal duty (spec §10.4): above 80 °F everything powered inside a lump duty-cycles on one line.
 * Every watt is multiplied by 1 − 0.025 × (T − 80), down to 0 at 120 °F, so a hot lump makes less
 * heat the hotter it gets and settles below 120 °F whatever its cooler. In a rack that is its
 * systems, switch and load balancer (the PDU loss follows what it delivers); in a zone it is the
 * network rack and the rack coolers, which stand in the zone's air. What the equipment does falls
 * on the same line: compute rates follow e(T), links send at thermalRate and a rack cooler moves
 * that share of its heat. The power phase applies it per rack, to its systems' summed draw
 * (systemDraw is the draw at duty 1), so a moving temperature re-runs no system step.
 */
export const thermalDuty = (tempF: number): number =>
  tempF <= EFF_FLAT_HIGH_F ? 1 : Math.max(0, 1 - EFF_LOSS_PER_F * (tempF - EFF_FLAT_HIGH_F));

/** What a hot link sends: its speed × the duty line, with e(T)'s rate floor so a transfer always moves. */
export const thermalRate = (tempF: number): number =>
  tempF <= EFF_FLAT_HIGH_F ? 1 : Math.max(EFF_MIN, 1 - EFF_LOSS_PER_F * (tempF - EFF_FLAT_HIGH_F));

/**
 * The share of its compiled speed link l sends this tick (spec §10.4): a rack switch port follows
 * its rack's temperature, a rack uplink the zone's (the network rack). Data plane and backbone
 * links sit in no lump. Hidden containers stay at 70 °F, so their links send at full speed.
 */
export function linkThermalRate(compiled: CompiledBuffers, hot: HotBuffers, l: number): number {
  const kind = compiled.link.kind[l], owner = compiled.link.owner[l]!;
  if (kind !== LINK_KIND.server && kind !== LINK_KIND.rack) return 1;
  if (owner < 0 || owner >= compiled.rack.len) return 1;
  if (kind === LINK_KIND.server) return thermalRate(hot.rack.tempF[owner]!);
  const room = compiled.rack.room[owner]!;
  return room >= 0 && room < compiled.room.len ? thermalRate(hot.room.tempF[room]!) : 1;
}

const cstateFactor = (w: World, depth: number): number => depth > 0 ? w.research.unlocks.ruleParams.coreIdle?.factor ?? 1 : 1;

/** Load factor of core watts from DVFS, turbo and throttle (spec §9.3). */
export function loadFactorOf(w: World, sys: number): number {
  const h = w.hot.sys;
  const pstate = h.dvfsOn[sys] === 1 ? DVFS_LOAD : h.turboOn[sys] === 1 ? TURBO_LOAD : 1;
  return pstate * (w.hot.rack.throttled[w.compiled.sys.rack[sys]!] === 1 ? THROTTLE_LOAD : 1);
}

/** The clock multiplier exec applies: DVFS or turbo, and throttle (spec §9.3). */
export function clockFactorOf(w: World, sys: number): number {
  const h = w.hot.sys;
  const pstate = h.dvfsOn[sys] === 1 ? DVFS_CLOCK : h.turboOn[sys] === 1 ? TURBO_CLOCK : 1;
  return pstate * (w.hot.rack.throttled[w.compiled.sys.rack[sys]!] === 1 ? THROTTLE_CLOCK : 1);
}

/**
 * Σ actualW = idleW × idleFactor + loadW × u × loadFactor over every part (spec §9.1, §9.3).
 * Watts follow work (D6.1): compile gives cores, RAM and drives
 * idleW = 0.1 × wPerUnit × native × push^0.25 and loadW = wPerUnit × rate × push^0.3 at clock
 * factor 1. Clock, caches, package and scheduler are idle-only, so the cores carry all CPU load
 * and DVFS, turbo and throttle scale it. CPU busy excludes reserved threads waiting on
 * GPU, RAM or IO stages. Accelerator watts come from evaluated hardware.
 * The lone system's pipe draws 0.1 W per bit/s it sent this tick (D10.4). Core utilization is `busy / cores`; RAM counts
 * as fully used while a stage runs, accelerators use per-card busy seconds, drives IO stages / ncq.
 */
export function systemDraw(w: World, sys: number, kind: number, settings: PhysSettings): number {
  if (kind === DRAW_NONE) return 0;
  // D38: before System the CPU draws a fixed power nothing changes (clock, cache and core upgrades included).
  if (!settings.realDraw) return PRE_SYSTEM_CPU_W;
  const c = w.compiled.sys, h = w.hot.sys;
  const o = sys * R;
  const uncoreIdle = c.idleW[o + CPU]!, ramIdle = c.idleW[o + RAM]!, gpuIdle = c.idleW[o + GPU]!, ioIdle = c.idleW[o + IO]!;
  if (kind === DRAW_SLEEP) {
    return S3_FACTOR * (c.coreIdleW[sys]! + c.clockIdleW[sys]! + uncoreIdle + ramIdle + gpuIdle + ioIdle);
  }
  const full = kind === DRAW_FULL;
  const cores = c.cores[sys]!;
  const busy = full && cores > 0 ? Math.min(cores, Math.max(0, h.busy[sys]!)) : 0;
  const u = cores > 0 ? busy / cores : 0;
  const coreIdle = cores > 0 ? (c.coreIdleW[sys]! * (busy + (cores - busy) * cstateFactor(w, h.cstate[sys]!))) / cores : c.coreIdleW[sys]!;
  const pkg = settings.packageIdle && busy === 0 ? PACKAGE_IDLE_FACTOR : 1;
  const idle = coreIdle + (c.clockIdleW[sys]! + uncoreIdle) * pkg + ramIdle + gpuIdle + ioIdle;
  let load = 0, coreLoad = 0;
  if (full) {
    const ioConc = Math.max(1, c.ioConc[sys]!);
    const ioU = Math.min(1, h.active[o + IO]! / ioConc);
    load = (h.active[o + RAM]! > 0 ? c.loadW[o + RAM]! : 0)
      + acceleratorLoadW(w, sys)
      + c.loadW[o + IO]! * ioU
      + c.pipeWPerBit[sys]! * h.pipeBits[sys]! / DT_S;
    coreLoad = c.coreLoadW[sys]! * u * loadFactorOf(w, sys);
  }
  return idle + load + coreLoad;
}

/** Exec integrates task and research duty through stage events, including mid-tick completion. */
function acceleratorLoadW(w: World, sys: number): number {
  const c = w.compiled.sys, h = w.hot.sys;
  let watts = 0;
  for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
    const p = sys * MAX_ACCELS + slot;
    const seconds = h.accelTaskS[p]! + h.accelResearchS[p]!;
    // Permit arithmetic roundoff, but never hide an execution budget overrun by clamping it.
    if (!(seconds >= -Number.EPSILON * 16 && seconds <= DT_S + Number.EPSILON * 16)) {
      throw new RangeError(`Invalid accelerator duty at system ${sys}, slot ${slot}: ${seconds}`);
    }
    watts += c.accelLoadW[p]! * seconds / DT_S;
  }
  return watts;
}

/**
 * C-state bookkeeping after this tick's draw, for the next tick (spec §9.3). Idle cores sink to
 * the deepest allowed state whose `after` has passed since the last tick every core was busy.
 */
export function updateCState(w: World, sys: number, settings: PhysSettings): void {
  const h = w.hot.sys;
  const cores = w.compiled.sys.cores[sys]!;
  if (cores === 0 || h.busy[sys]! >= cores) {
    h.idleSinceTick[sys] = w.tick;
    h.cstate[sys] = 0;
    return;
  }
  const idleFor = w.tick - h.idleSinceTick[sys]!;
  let depth = 0;
  const max = settings.cmax[sys]!;
  for (let i = 0; i < max; i += 1) if (CSTATES[i]!.afterTicks <= idleFor) depth = CSTATES[i]!.depth;
  h.cstate[sys] = depth;
}

/**
 * P-state switches for the next tick (spec §9.3). DVFS holds while nothing is queued or reserved,
 * and no CPU thread holds research.
 * Turbo needs DVFS off and, once the rack is opened, the rack under 80 °F.
 */
export function updatePStates(w: World, sys: number, settings: PhysSettings): void {
  const h = w.hot.sys;
  const flags = settings.sys[sys]!;
  const dvfs = (flags & SYS_DVFS) !== 0 && h.queueLen[sys] === 0 && h.reserved[sys] === 0 && h.researchThreads[sys] === 0;
  const rack = w.compiled.sys.rack[sys]!;
  const coolRack = w.compiled.rack.opened[rack] !== 1 || w.hot.rack.tempF[rack]! < TURBO_MAX_F;
  const turbo = (flags & SYS_TURBO) !== 0 && !dvfs && coolRack;
  h.dvfsOn[sys] = dvfs ? 1 : 0;
  h.turboOn[sys] = turbo ? 1 : 0;
}

/** Writes `clockFactor` for the next tick and dirties the rack when it moved (R15). */
export function publishClockFactor(w: World, sys: number): void {
  const next = clockFactorOf(w, sys);
  if (w.hot.sys.clockFactor[sys] === next) return;
  w.hot.sys.clockFactor[sys] = next;
  dirtySystem(w, sys);
}
