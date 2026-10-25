import { G } from '../core/buffers';
import { MAX_UPS } from '../core/constants';
import { MODE, setUnitMode } from '../core/timers';
import { touchSystem } from '../core/touch';
import type { World } from '../core/world';
import { CAP_STEPS_MAX, CSTATES, S3_AFTER_TICKS, S3_WAKE_TICKS } from './constants';
import { DRAW_NONE, capTenths, drawKind, publishClockFactor, systemDraw, updateCState, updatePStates } from './draw';
import { billSite, billUtility, linkWatts, routerW } from './energy';
import { forRackSystems, syncMode, zoneDark } from './modes';
import { collectSteps, noteDue, noteUnstable, powerCache, recordInputs, refreshRackContexts, resumRack, type PowerCache } from './powerCache';
import { scratch } from './scratch';
import { SYS_CAPPED, physSettings, type PhysSettings } from './settings';
import {
  failGrid, failPdu, failPsu, failUps, overloadFailed, stepCap, stepOverload, supplyLossW, supplyUsage, tickReboots,
} from './supplies';

/**
 * Power phase (tick step 8, spec §9): bottom up, systems → rack PDUs → zone UPSs → site grids.
 * Draws use the switches and temperatures from the start of the tick and the cooler watts the
 * previous heat step set. Everything is billed for this tick; failures found here take effect
 * from the next tick, after the running reboot timers count down.
 *
 * Systems are event-driven (powerCache.ts): only a system whose inputs or rack context changed,
 * or whose last step was not a fixed point, runs its step; the others keep their contribution.
 * Racks, zones and sites are few and their cooler, switch and router watts move every tick, so
 * they run every tick from the cached rack sums.
 */
export function powerPhase(w: World): void {
  const settings = physSettings(w);
  const c = w.compiled, h = w.hot;
  // D27: only research holders draw for research.
  const researchOn = w.hot.g[G.researchHolders]! > 0;
  const k = powerCache(w, settings, researchOn);
  const links = linkWatts(w);

  /* A changed supply, lump, throttle or PDU cap re-runs every system of the rack. */
  const dark = scratch('roomDark', c.room.len);
  for (let m = 0; m < c.room.len; m += 1) dark[m] = zoneDark(w, m) ? 1 : 0;
  refreshRackContexts(w, k, dark);

  /* Systems: draw, board PSU, C-states and P-states for the next tick. */
  let psuFails: number[] | null = null;
  const steps = collectSteps(w, k, k.steps);
  for (let i = 0; i < steps; i += 1) {
    const s = k.steps[i]!;
    k.rackResum[c.sys.rack[s]!] = 1;
    if (systemStep(w, s, settings, researchOn, k)) (psuFails ??= []).push(s);
  }
  for (let r = 0; r < c.rack.len; r += 1) {
    if (k.rackResum[r] === 1 || k.rackForce[r] === 1) resumRack(w, r, k);
    k.rackResum[r] = 0; k.rackForce[r] = 0;
  }

  /* Rack PDUs: system inputs plus cooler, switch and load balancer (spec §9.2). */
  const roomIn = scratch('roomIn', c.room.len), roomHeat = scratch('roomHeat', c.room.len), roomAny = scratch('roomAny', c.room.len);
  let pduFails: number[] | null = null;
  {
    // Hoisted: tables are dictionary-mode objects (built by computed keys), so a per-row column lookup is a hash probe.
    const cr = c.rack, hr = h.rack, roomCrashed = h.room.crashed;
    const alive = cr.alive, roomOf = cr.room, openedOf = cr.opened, pduCapW = cr.pduCapW, pduLoss = cr.pduLoss;
    const lbIdleW = cr.lbIdleW;
    const crashedOf = hr.crashed, pduFailed = hr.pduFailed, coolerWOf = hr.coolerW, capFactor = hr.capFactor, eff = hr.eff;
    const pduOver = hr.pduOverTicks, drawW = hr.drawW, pduUsage = hr.pduUsage, heatW = hr.heatW, pduCapped = settings.pduCapped;
    for (let r = 0; r < cr.len; r += 1) {
      if (alive[r] !== 1) continue;
      const room = roomOf[r]!;
      const opened = openedOf[r] === 1;
      const crashed = crashedOf[r] === 1 || roomCrashed[room] === 1;
      const powered = opened && pduFailed[r] === 0 && (k.rackAny[r] === 1 || crashed);
      const switchW = powered ? links.rack[r]! : 0;
      const lbW = powered ? routerW(lbIdleW[r]!) : 0;
      const coolerW = powered ? coolerWOf[r]! : 0;
      const delivered = k.rackIn[r]! + switchW + lbW + coolerW;
      const cap = opened ? pduCapW[r]! : 0;
      const usage = supplyUsage(delivered, cap);
      const loss = cap > 0 ? supplyLossW(delivered, cap, pduLoss[r]!) : 0;
      const capped = cap > 0 && pduCapped[r] === 1;
      const capLoad = k.rackCapLoad[r]!;
      const fixed = delivered - capLoad * capFactor[r]!;
      pduOver[r] = stepOverload(pduOver[r]!, usage, !capped || fixed > cap);
      const nextCap = capped && delivered > 0 ? stepCap(capTenths(capFactor[r]!), fixed, capLoad, cap) / CAP_STEPS_MAX : capped ? capFactor[r]! : 1;
      if (nextCap !== capFactor[r]) {
        capFactor[r] = nextCap;
        forRackSystems(w, r, (s) => publishClockFactor(w, s));
      }
      drawW[r] = delivered;
      pduUsage[r] = usage;
      heatW[r] = opened ? k.rackCompute[r]! / eff[r]! + k.rackPlain[r]! + loss + switchW + lbW : 0;
      roomIn[room] = roomIn[room]! + delivered + loss;
      roomHeat[room] = roomHeat[room]! + coolerW;
      if (delivered > 0 || crashed) roomAny[room] = 1;
      if (overloadFailed(pduOver[r]!)) (pduFails ??= []).push(r);
    }
  }
  /* Zone UPSs: rack inputs plus network rack and room cooling, split across live UPSs (dualFeed). */
  const siteIn = scratch('siteIn', c.site.len), siteAny = scratch('siteAny', c.site.len);
  const upsFails: number[] = [];
  for (let m = 0; m < c.room.len; m += 1) {
    if (c.room.alive[m] !== 1) continue;
    const site = c.room.site[m]!;
    const opened = c.room.opened[m] === 1;
    const powered = opened && dark[m] !== 1 && (roomAny[m] === 1 || h.room.crashed[m] === 1);
    const networkW = powered ? links.room[m]! + routerW(c.room.lbIdleW[m]!) : 0;
    const coolerW = powered ? h.room.coolerW[m]! : 0;
    const delivered = roomIn[m]! + networkW + coolerW;
    const loss = opened ? upsStep(w, m, delivered, settings, (i) => upsFails.push(m * MAX_UPS + i)) : 0;
    h.room.drawW[m] = delivered;
    h.room.heatW[m] = opened ? roomHeat[m]! + networkW + loss : 0;
    siteIn[site] = siteIn[site]! + delivered + loss;
    if (delivered > 0 || h.room.crashed[m] === 1) siteAny[site] = 1;
  }

  /* Site grids and billing (spec §9.6). */
  let gridFails: number[] | null = null;
  let anyPowered = false;
  for (let s = 0; s < c.site.len; s += 1) {
    if (c.site.alive[s] !== 1) continue;
    const opened = c.site.opened[s] === 1;
    const powered = siteAny[s] === 1;
    anyPowered ||= powered;
    const delivered = siteIn[s]! + (opened && powered ? links.site[s]! : 0);
    const up = opened && h.site.gridFailed[s] === 0;
    const cap = up ? c.site.gridCapW[s]! : 0;
    const usage = supplyUsage(delivered, cap);
    const loss = cap > 0 ? supplyLossW(delivered, cap, c.site.gridLoss[s]!) : 0;
    h.site.gridOverTicks[s] = stepOverload(h.site.gridOverTicks[s]!, usage);
    h.site.drawW[s] = delivered;
    h.site.gridUsage[s] = usage;
    billSite(w, s, delivered + loss);
    if (overloadFailed(h.site.gridOverTicks[s]!)) (gridFails ??= []).push(s);
  }
  billUtility(w, links.utility, anyPowered);

  /* Running reboots count down first, so a supply failing now is dark for the full boot time. */
  tickReboots(w);
  if (psuFails) for (const s of psuFails) failPsu(w, s);
  if (pduFails) for (const r of pduFails) failPdu(w, r);
  for (const i of upsFails) failUps(w, Math.floor(i / MAX_UPS), i % MAX_UPS);
  if (gridFails) for (const s of gridFails) failGrid(w, s);
}

/** One zone's UPS step. Returns the summed loss; reports UPS indices that reached 10 s. */
function upsStep(w: World, m: number, delivered: number, settings: PhysSettings, onFail: (index: number) => void): number {
  const c = w.compiled.room, h = w.hot.room;
  const count = Math.min(MAX_UPS, settings.upsCount[m]!);
  let live = 0;
  for (let i = 0; i < count; i += 1) if (h.upsFailed[m * MAX_UPS + i] === 0) live += 1;
  let loss = 0;
  for (let i = 0; i < count; i += 1) {
    const k = m * MAX_UPS + i;
    const up = h.upsFailed[k] === 0;
    const share = up && live > 0 ? delivered / live : 0;
    const cap = up ? c.upsCapW[k]! : 0;
    const usage = supplyUsage(share, cap);
    if (cap > 0) loss += supplyLossW(share, cap, c.upsLoss[k]!);
    h.upsUsage[k] = usage;
    h.upsOverTicks[k] = stepOverload(h.upsOverTicks[k]!, usage);
    if (overloadFailed(h.upsOverTicks[k]!)) onFail(i);
  }
  return loss;
}


/**
 * One system's full power step. Writes its rack contributions to the cache and records whether
 * it was a fixed point: it changed none of the system's phys state and its overload timer is
 * idle. A running C-state or S3 timer changes nothing until its threshold tick, which is kept as
 * the step's due tick. Returns true when its PSU fails this tick.
 */
function systemStep(w: World, s: number, settings: PhysSettings, researchOn: boolean, k: PowerCache): boolean {
  const c = w.compiled, h = w.hot, sys = h.sys;
  const mode0 = sys.mode[s], cap0 = sys.capFactor[s], over0 = sys.psuOverTicks[s], cstate0 = sys.cstate[s];
  const dvfs0 = sys.dvfsOn[s], turbo0 = sys.turboOn[s], wake0 = sys.wakeTicks[s], clock0 = sys.clockFactor[s];
  syncMode(w, s);
  const kind = drawKind(sys.mode[s]!, researchOn && sys.researchThreads[s]! > 0);
  const d = systemDraw(w, s, kind, settings);
  const delivered = d.deliveredW;
  const cap = settings.psuLive ? c.sys.psuCapW[s]! : 0;
  const usage = supplyUsage(delivered, cap);
  const loss = cap > 0 ? supplyLossW(delivered, cap, c.sys.psuLoss[s]!) : 0;
  const capped = cap > 0 && (settings.sys[s]! & SYS_CAPPED) !== 0;
  const capNow = sys.capFactor[s]!, rackCap = h.rack.capFactor[c.sys.rack[s]!]!;
  const fixed = delivered - d.capLoadW * capNow * rackCap;
  sys.psuOverTicks[s] = stepOverload(sys.psuOverTicks[s]!, usage, !capped || fixed > cap);
  if (!capped) sys.capFactor[s] = 1;
  else if (kind !== DRAW_NONE) {
    sys.capFactor[s] = stepCap(capTenths(capNow), fixed, d.capLoadW * rackCap, cap) / CAP_STEPS_MAX;
  }
  sys.drawW[s] = delivered;
  sys.psuUsage[s] = usage;
  k.delivered[s] = delivered; k.loss[s] = loss; k.capLoad[s] = d.capLoadW * capNow;
  const cores = c.sys.cores[s]!, fullyBusy = cores === 0 || sys.busy[s]! >= cores;
  let due = Infinity;
  if (kind !== DRAW_NONE) {
    updateCState(w, s, settings);
    updatePStates(w, s, settings);
    // Idle cores sink to the next allowed C-state once its delay has passed.
    if (!fullyBusy) {
      const idleFor = w.tick - sys.idleSinceTick[s]!, max = settings.cmax[s]!;
      for (let i = 0; i < max; i += 1) {
        if (CSTATES[i]!.afterTicks > idleFor) { due = sys.idleSinceTick[s]! + CSTATES[i]!.afterTicks; break; }
      }
    }
  }
  const sleep = sleepStep(w, s, settings);
  if (sleep === SLEEP_WAIT) due = Math.min(due, Math.max(sys.emptySinceTick[s]!, w.round.startTick) + S3_AFTER_TICKS);
  publishClockFactor(w, s);
  const failed = overloadFailed(sys.psuOverTicks[s]!);
  k.stampIdle[s] = kind !== DRAW_NONE && fullyBusy ? 1 : 0;
  k.stampEmpty[s] = sleep === SLEEP_STAMP ? 1 : 0;
  k.due[s] = due;
  k.stable[s] = !failed && sleep !== SLEEP_CHANGED && over0 === 0 && sys.psuOverTicks[s] === 0
    && sys.mode[s] === mode0 && sys.capFactor[s] === cap0 && sys.cstate[s] === cstate0 && sys.dvfsOn[s] === dvfs0
    && sys.turboOn[s] === turbo0 && sys.wakeTicks[s] === wake0 && sys.clockFactor[s] === clock0
    && sys.psuRebootTicks[s] === 0 ? 1 : 0;
  if (k.stable[s] === 0) noteUnstable(k, s);
  if (due !== Infinity) noteDue(k, s, due);
  recordInputs(w, s, k);
  return failed;
}

/** sleepStep outcomes: no write, a tick stamp, a wait on the S3 timer, or a change or countdown. */
const SLEEP_NONE = 0, SLEEP_STAMP = 1, SLEEP_WAIT = 2, SLEEP_CHANGED = 3;

/**
 * S3 sleep (spec §9.3): an on-market system in an opened rack with nothing admitted or reserved
 * for 10 s (a research holder counts as holding, D27), sleeps. A pending wake ends 2 s after the route.
 */
function sleepStep(w: World, s: number, settings: PhysSettings): number {
  const h = w.hot.sys;
  const mode = h.mode[s]!;
  if (mode === MODE.asleep) {
    const wake = h.wakeTicks[s]!;
    if (wake === 0) return SLEEP_NONE;
    h.wakeTicks[s] = wake - 1;
    if (wake === 1) { setUnitMode(w, s, MODE.onMarket); h.emptySinceTick[s] = w.tick; }
    return SLEEP_CHANGED;
  }
  // Paused systems are left untouched so quiescent ticks change nothing; the round start bounds the wait instead.
  if (mode === MODE.paused || mode === MODE.empty) return SLEEP_NONE;
  const holding = h.running[s]! + h.queueLen[s]! + h.reserved[s]! + h.researchThreads[s]! > 0;
  if (mode !== MODE.onMarket || holding) { h.emptySinceTick[s] = w.tick; return SLEEP_STAMP; }
  if (!settings.s3Sleep || w.compiled.rack.opened[w.compiled.sys.rack[s]!] !== 1) return SLEEP_NONE;
  if (w.tick - Math.max(h.emptySinceTick[s]!, w.round.startTick) < S3_AFTER_TICKS) return SLEEP_WAIT;
  setUnitMode(w, s, MODE.asleep);
  return SLEEP_CHANGED;
}

/** A route to an asleep system wakes it: it is on market 2 s later (spec §9.3). Net calls this. */
export function wakeSystem(w: World, s: number): void {
  if (w.hot.sys.mode[s] === MODE.asleep && w.hot.sys.wakeTicks[s] === 0) { w.hot.sys.wakeTicks[s] = S3_WAKE_TICKS; touchSystem(w, s); }
}
