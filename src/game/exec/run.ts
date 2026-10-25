import { G, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import type { TouchLog } from '../core/touch';
import { ACCEL_CLOCKS, DT_S, SERVERS_PER_RACK } from '../core/constants';
import { MODE, startTransition } from '../core/timers';
import { touchRack } from '../core/touch';
import type { World } from '../core/world';
import { drainQueue, landPipe, pullLone, startQueued } from './alloc';
import { axisAt, fillSpan, newSpan, nextDueTick, setRate, type Span } from './clocks';
import { anchorAccelDomains } from './accelerators';
import { integrateAccelerators, resetAccelUsage, resetSystemAccelUsage } from './accelUsage';
import { publishRunBoundary } from './boundary';
import { hwThreads } from './est';
import { completeRecord } from './outcome';
import { researchOn, researchRateOf, taskShare } from './research';
import { strategyOf } from './schedulers';
import { keffOf, runsTasks } from './slots';
import { stealThreads } from './stealing';
import { leaveStage, promoteIo, releaseRunning, enterStage } from './stages';
import { CPU, GPU, IO, NRES, RAM, shapeOf } from './shape';
import { diskRate, firstPart } from './memory';

/**
 * Run phase: allocate, then process completion events, stage transitions and in-tick chaining.
 * CPU/RAM/IO shares stay fixed for the tick. Accelerator shares change at stage events.
 * Hardware and power factors stay fixed for the tick. Research ops are tallied per system.
 */

/**
 * Rack skip (architecture §1.5). A rack is visited when it is dirty, when its nextDue tick has
 * come, when it is a hidden container, or on a tick whose fleet-wide rate inputs differ from the
 * ones the buffers were last anchored against (G.execStamp). Any other visit would process no
 * event and leave clocks, rates and meters as they are, so skipping it changes nothing. While
 * research runs, a skipped rack still tallies its research, which follows e(T) every tick.
 */
function execStamp(w: World, research: boolean): number {
  const running = w.round.phase === 'running' ? 1 : 0;
  // D27: research holders change only at takes and releases, which dirty their racks; the count stamps the rest.
  return 1 + ((w.build.revision * 2 + running) * 2 + (research ? 1 : 0)) * 65_536 + w.hot.g[G.researchHolders]! % 65_536;
}

const span = newSpan();

/** Before Rack the system's rack is a hidden container and the system takes the head itself, over its pipe. */
export const isLone = (w: World, s: number): boolean => w.compiled.rack.opened[w.compiled.sys.rack[s]!] !== 1;

/** Σ threads of the tasks in a compute stage (time slicing shares the cores among them). */
function cpuThreads(w: World, s: number): number {
  const rec = w.hot.rec;
  let sum = 0;
  for (let r = w.hot.sys.head[s * NRES + CPU]!; r >= 0; r = rec.next[r]!) sum += rec.count[r]! * rec.threads[r]!;
  return sum;
}

/** Sets this tick's rate on each resource clock from the counts at the start of processing. */
function anchorRates(w: World, s: number, sp: Span, share: number, runs: boolean): void {
  const c = w.compiled.sys, h = w.hot.sys;
  const i = s * NRES;
  if (!runs) {
    for (let r = 0; r < NRES; r += 1) setRate(w, s, r, sp.x0[r]!, 0);
    return;
  }
  const eta = c.etaCfg[s]!;
  let cpu = c.threadRate[s]! * h.clockFactor[s]! * eta * share;
  if (strategyOf(w, s).timeSlice) cpu *= Math.min(1, hwThreads(w, s) / Math.max(1, cpuThreads(w, s)));
  setRate(w, s, CPU, sp.x0[CPU]!, cpu);
  setRate(w, s, RAM, sp.x0[RAM]!, c.ramBw[s]! / Math.max(1, h.active[i + RAM]!));
  setRate(w, s, GPU, sp.x0[GPU]!, 0);
  setRate(w, s, IO, sp.x0[IO]!, diskRate(w, s) / Math.max(1, h.ioHolds[s]!));
}

/** The lone system's take at τ (spec §6.4): at allocation, at a completion and when a transfer lands. */
function pull(w: World, s: number, tau: number): void {
  if (isLone(w, s) && w.hot.sys.mode[s] === MODE.onMarket && w.round.phase === 'running') pullLone(w, s, tau);
}

/** Allocation at τ (spec §6.7 steps 1 and 3): the lone system's take, then queued starts. */
function allocate(w: World, s: number, tau: number): number {
  pull(w, s, tau);
  return startQueued(w, s, tau, span);
}

/** τ at which s's pipe transfer lands within this tick, or Infinity. */
function pipeLandTau(w: World, s: number, cursor: number): number {
  const h = w.hot.sys;
  if (h.pipeRec[s]! < 0) return Infinity;
  const t = h.pipeT0[s]! + h.pipeLeft[s]! / (w.compiled.sys.pipeSpeed[s]! * DT_S);
  return t <= 1 ? Math.max(cursor, t) : Infinity;
}

/** The pipe sends for the rest of the tick; its remaining bits carry to the next (spec §6.4). */
function closePipe(w: World, s: number): void {
  const h = w.hot.sys;
  if (h.pipeRec[s]! >= 0) {
    const sent = Math.min(h.pipeLeft[s]!, (1 - h.pipeT0[s]!) * w.compiled.sys.pipeSpeed[s]! * DT_S);
    h.pipeBits[s] = h.pipeBits[s]! + sent;
    h.pipeLeft[s] = h.pipeLeft[s]! - sent;
  }
  h.pipeT0[s] = 0;
}

/** Processes completion events of system s in τ order. Returns the number of events. */
function runEvents(w: World, s: number, share: number): number {
  const h = w.hot.sys, rec = w.hot.rec;
  const chain = !strategyOf(w, s).timeSlice;
  let events = 0;
  let cursor = 0;
  const base = s * NRES, accelBase = s * ACCEL_CLOCKS;
  const gx0 = span.x0[GPU]!, gx1 = span.x1[GPU]!;
  for (;;) {
    let res = -1, accel = -1, tau = Infinity;
    // Exact ties: CPU, RAM, domains in slot/mode order, then IO (the first strict minimum wins).
    for (let resource = CPU; resource <= RAM; resource += 1) {
      const due = h.due[base + resource]!, x0 = span.x0[resource]!, x1 = span.x1[resource]!;
      if (!(due <= x1)) continue;
      const t = x1 > x0 ? Math.max(cursor, (due - x0) / (x1 - x0)) : cursor;
      if (t < tau) { tau = t; res = resource; }
    }
    for (let clock = 0; clock < ACCEL_CLOCKS; clock += 1) {
      const due = h.accelDue[accelBase + clock]!;
      if (!(due <= gx1)) continue;
      const t = gx1 > gx0 ? Math.max(cursor, (due - gx0) / (gx1 - gx0)) : cursor;
      if (t < tau) { tau = t; res = GPU; accel = clock; }
    }
    {
      const due = h.due[base + IO]!, x0 = span.x0[IO]!, x1 = span.x1[IO]!;
      if (due <= x1) {
        const t = x1 > x0 ? Math.max(cursor, (due - x0) / (x1 - x0)) : cursor;
        if (t < tau) { tau = t; res = IO; accel = -1; }
      }
    }
    const pipeTau = pipeLandTau(w, s, cursor);
    if (pipeTau < tau) {
      integrateAccelerators(w, s, cursor, pipeTau, span, share, true);
      cursor = pipeTau;
      events += 1;
      landPipe(w, s, pipeTau);
      pull(w, s, pipeTau);
      if (chain) startQueued(w, s, pipeTau, span);
      continue;
    }
    if (res < 0) {
      integrateAccelerators(w, s, cursor, 1, span, share, true);
      return events;
    }
    integrateAccelerators(w, s, cursor, tau, span, share, true);
    cursor = tau;
    events += 1;
    const r = accel >= 0 ? h.accelHead[s * ACCEL_CLOCKS + accel]! : h.head[s * NRES + res]!;
    const doneW = rec.finish[r]!;
    leaveStage(w, s, r, axisAt(span, GPU, tau));
    // D26.2: a stage runs its parts in order (main, RAM, disk), each on its own clock; then the next stage.
    const shape = shapeOf(rec.family[r]!);
    const part = firstPart(w, r, shape, rec.stage[r]!, rec.part[r]! + 1);
    if (part >= 0) {
      rec.part[r] = part;
      enterStage(w, s, r, tau, span, res, doneW);
    } else if (rec.stage[r]! + 1 < shape.stages) {
      rec.stage[r] = rec.stage[r]! + 1;
      rec.part[r] = firstPart(w, r, shape, rec.stage[r]!, 0);
      enterStage(w, s, r, tau, span, res, doneW);
    } else {
      const domain = rec.accelDomain[r]!;
      releaseRunning(w, s, r);
      completeRecord(w, s, r, tau, domain);
      if (chain) allocate(w, s, tau);
    }
    if (res === IO) promoteIo(w, s, tau, span);
  }
}

/** A queued task may start on a later tick without an event (pickQueue can depend on the tick). */
const mayStart = (w: World, s: number): boolean => w.hot.sys.queueLen[s]! > 0 && w.hot.sys.running[s]! < keffOf(w, s);

/**
 * Skipped-rack research tallies (derived, never state). A rack skipped on consecutive ticks of one
 * advance call kept every tally input but e(T): nothing dirtied it, so its modes, clock factors,
 * busy threads and accelerator holders are those of the last tally. Its card duty and busy cores
 * are then already what a new tally would write, and its research is the cached CPU rate and
 * accelerator base at this tick's e(T) and GPU axis step, by the same float expressions.
 */
interface TallyCache { hot: HotBuffers; log: TouchLog; compiled: CompiledBuffers; at: Int32Array; rate: Float64Array; base: Float64Array }
let tally: TallyCache | null = null;
function tallyCache(w: World, log: TouchLog): TallyCache {
  const c = w.compiled;
  if (!tally || tally.hot !== w.hot || tally.log !== log || tally.compiled !== c || tally.at.length < c.rack.len || tally.rate.length < c.sys.len) {
    tally = { hot: w.hot, log, compiled: c, at: new Int32Array(c.rack.len).fill(-2), rate: new Float64Array(c.sys.len), base: new Float64Array(c.sys.len) };
  }
  return tally;
}

/** A skipped system's research tally: what a visit without events would compute. */
function tallyResearch(w: World, s: number, share: number, eff: number, t: TallyCache | null): number {
  const runs = runsTasks(w.hot.sys.mode[s]!) && w.round.phase === 'running';
  resetSystemAccelUsage(w, s);
  const base = integrateAccelerators(w, s, 0, 1, span, share, runs);
  const rate = researchRateOf(w, s, share);
  if (t) { t.base[s] = base; t.rate[s] = rate; }
  const ops = rate * eff * DT_S + w.hot.sys.accelResearchOps[s]!;
  w.hot.sys.researchOps[s] = ops;
  return ops;
}

/** tallyResearch for a system whose rack was tallied last tick (see TallyCache). */
function retally(w: World, s: number, eff: number, deltaE: number, t: TallyCache): number {
  const h = w.hot.sys;
  const accel = 0 + t.base[s]! * w.compiled.sys.etaCfg[s]! * deltaE;
  h.accelResearchOps[s] = accel;
  const ops = t.rate[s]! * eff * DT_S + accel;
  h.researchOps[s] = ops;
  return ops;
}

/**
 * System skip inside a visited rack (derived, never state): the rack skip at system grain. A system
 * whose last visit in this advance call changed nothing (no event, no start, no steal),
 * that nobody dirtied since (core/touch.ts dirtySystem: every rack-dirty write names its system)
 * and that has no completion due within this tick's span would be visited to exactly what it
 * holds, as a skipped rack's systems are; so it is passed over (tallied when research runs).
 */
interface SkipCache { hot: HotBuffers; log: TouchLog; compiled: CompiledBuffers; cleanFrom: Int32Array }
let skip: SkipCache | null = null;
function skipCache(w: World, log: TouchLog): SkipCache {
  const c = w.compiled;
  if (!skip || skip.hot !== w.hot || skip.log !== log || skip.compiled !== c || skip.cleanFrom.length < c.sys.len) {
    skip = { hot: w.hot, log, compiled: c, cleanFrom: new Int32Array(c.sys.len).fill(-1) };
    log.allDirty = false;
  }
  if (log.allDirty) { skip.cleanFrom.fill(-1); log.allDirty = false; }
  return skip;
}

/** No completion, stage end or pipe landing of system s falls within this tick's span (runEvents' tests). */
function nothingDue(w: World, s: number): boolean {
  const h = w.hot.sys;
  if (h.pipeRec[s]! >= 0) return false;
  const base = s * NRES;
  if (h.due[base + CPU]! <= span.x1[CPU]! || h.due[base + RAM]! <= span.x1[RAM]! || h.due[base + IO]! <= span.x1[IO]!) return false;
  const gx1 = span.x1[GPU]!;
  for (let clock = 0; clock < ACCEL_CLOCKS; clock += 1) if (h.accelDue[s * ACCEL_CLOCKS + clock]! <= gx1) return false;
  return true;
}

/** Ends the run phase's use of the dirty list: systems dirtied and not visited since lose their clean mark. */
function drainDirty(log: TouchLog, sk: SkipCache | null): void {
  for (let i = 0; i < log.dirtyN; i += 1) {
    const s = log.dirtyList[i]!;
    if (log.dirtyMark[s] !== 1) continue;
    log.dirtyMark[s] = 0;
    if (sk && s < sk.cleanFrom.length) sk.cleanFrom[s] = -1;
  }
  log.dirtyN = 0;
}

/** One system's tick. Returns true when its counts changed (rates must be re-derived next tick). */
function visitSystem(w: World, s: number, share: number): boolean {
  const h = w.hot.sys;
  const mode = h.mode[s]!;
  const runs = runsTasks(mode) && w.round.phase === 'running';
  let changed = false;
  h.pipeBits[s] = 0;
  if (mode === MODE.draining && h.queueLen[s]! > 0) { drainQueue(w, s); changed = true; }
  if (runs) {
    if (stealThreads(w, s, span)) changed = true;
    if (allocate(w, s, 0) > 0) changed = true;
  }
  anchorRates(w, s, span, share, runs);
  anchorAccelDomains(w, s, span.x0[GPU]!, share);
  if (runs) { if (runEvents(w, s, share) > 0) changed = true; }
  else integrateAccelerators(w, s, 0, 1, span, share, false);
  if (runs) closePipe(w, s);
  if (mode === MODE.draining && h.running[s] === 0 && h.queueLen[s] === 0) startTransition(w, s, 'goingOffline');
  return changed;
}

export function runPhase(w: World): void {
  const c = w.compiled, hot = w.hot;
  const share = taskShare(w);
  const research = researchOn(w);
  const stamp = execStamp(w, research);
  const all = w.visitAll === true || hot.g[G.execStamp] !== stamp;
  hot.g[G.execStamp] = stamp;
  // A full pass also clears meters of dead systems; otherwise each visit clears its own.
  if (all) resetAccelUsage(w);
  let ops = 0;
  // Without a touch log (phases driven by hand) every skipped rack is tallied in full.
  const t = research && w.touch ? tallyCache(w, w.touch) : null;
  const log = w.touch, sk = log ? skipCache(w, log) : null;
  for (let rack = 0; rack < c.rack.len; rack += 1) {
    if (c.rack.alive[rack] !== 1) continue;
    const visit = all || hot.rack.dirty[rack] === 1 || w.tick >= hot.rack.nextDue[rack]! || c.rack.opened[rack] !== 1;
    if (!visit && !research) continue;
    if (visit) touchRack(w, rack);
    fillSpan(w, rack, span);
    const eff = hot.rack.eff[rack]!;
    if (!visit) {
      const again = t !== null && t.at[rack] === w.tick - 1, deltaE = 1 * (span.x1[GPU]! - span.x0[GPU]!);
      for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
        const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
        if (s >= 0 && c.sys.alive[s] === 1) ops += again ? retally(w, s, eff, deltaE, t) : tallyResearch(w, s, share, eff, t);
      }
      if (t) t.at[rack] = w.tick;
      continue;
    }
    if (t) t.at[rack] = -2;
    let next = Infinity, dirty = 0;
    const mayPass = sk !== null && !all && c.rack.opened[rack] === 1;
    for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
      const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
      if (s < 0 || c.sys.alive[s] !== 1) continue;
      if (mayPass && sk.cleanFrom[s]! >= 0 && log!.dirtyMark[s] !== 1 && nothingDue(w, s)) {
        if (mayStart(w, s)) dirty = 1;
        if (research) ops += tallyResearch(w, s, share, eff, null);
        const due = nextDueTick(w, s, span);
        if (due < next) next = due;
        continue;
      }
      if (!all) resetSystemAccelUsage(w, s);
      const changed = visitSystem(w, s, share);
      if (changed || mayStart(w, s)) dirty = 1;
      // A visit that started nothing found no queued task that fits (pickQueue skips any that does
      // not; one that does always starts), and that holds until the system changes: still clean.
      if (sk) { sk.cleanFrom[s] = changed ? -1 : w.tick; if (s < log!.dirtyMark.length) log!.dirtyMark[s] = 0; }
      const due = nextDueTick(w, s, span);
      if (due < next) next = due;
      const rate = researchRateOf(w, s, share);
      hot.sys.researchOps[s] = rate * eff * DT_S + hot.sys.accelResearchOps[s]!;
      ops += hot.sys.researchOps[s]!;
    }
    hot.rack.nextDue[rack] = next;
    hot.rack.dirty[rack] = dirty;
  }
  if (log) drainDirty(log, sk);
  if (research && ops > 0) hot.g[G.researchOps] = hot.g[G.researchOps]! + ops;
  publishRunBoundary(w);
}
