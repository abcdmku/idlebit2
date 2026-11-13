import { G } from '../core/buffers';
import { DT_S, MAX_UPS } from '../core/constants';
import { MODE, setUnitMode } from '../core/timers';
import { touchSystem } from '../core/touch';
import type { World } from '../core/world';
import { CSTATES, OVERLOAD_TRIP_TICKS, S3_AFTER_TICKS, S3_WAKE_TICKS } from './constants';
import { RACKS_PER_ROOM, SERVERS_PER_RACK, MAX_ZONES_PER_SITE } from '../core/constants';
import { startTransition } from '../core/timers';
import { killSystem } from '../exec/kill';
import { DRAW_NONE, drawKind, publishClockFactor, systemDraw, thermalDuty, updateCState, updatePStates } from './draw';
import { billSite, billUtility, linkWatts, routerW, sitePrice } from './energy';
import { generationFuelShare, siteGenerationW } from './start';
import { collectSteps, noteDue, noteUnstable, powerCache, recordInputs, refreshRackContexts, resumRack, writeRackDraw, type PowerCache } from './powerCache';
import { scratch } from './scratch';
import { physSettings, type PhysSettings } from './settings';
import { supplyLossW, supplyMultiplier, supplyUsage } from './supplies';

/**
 * Power phase (tick step 8, spec §9): bottom up, systems → rack PDUs → zone UPSs → site grids.
 * Draws use the switches and temperatures from the start of the tick and the cooler watts the
 * previous heat step set. Everything is billed for this tick. A supply over its capacity for more
 * than 10 s trips after billing: its systems lose their work and restart cold (spec §9.2, D82).
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

  /* A changed lump or throttle re-runs every system of the rack. */
  refreshRackContexts(w, k);

  /* Systems: draw, C-states and P-states for the next tick. */
  const steps = collectSteps(w, k, k.steps);
  for (let i = 0; i < steps; i += 1) {
    const s = k.steps[i]!;
    k.rackResum[c.sys.rack[s]!] = 1;
    systemStep(w, s, settings, researchOn, k);
  }
  for (let r = 0; r < c.rack.len; r += 1) {
    if (k.rackResum[r] === 1 || k.rackForce[r] === 1) resumRack(r, k);
    k.rackResum[r] = 0; k.rackForce[r] = 0;
  }

  /* Rack PDUs: system inputs, switch and load balancer at the rack's thermal duty, plus the cooler (spec §9.2, §10.4). */
  const roomIn = scratch('roomIn', c.room.len), roomHeat = scratch('roomHeat', c.room.len), roomAny = scratch('roomAny', c.room.len);
  // D31.3: watts each room's racks drew from their batteries this tick (not billed).
  const roomBat = scratch('roomBat', c.room.len), roundOn = w.round.phase === 'running';
  // Racks to trip once this tick is billed: a supply over its capacity for more than 10 s.
  let trips: number[] | null = null;
  {
    // Columns hoisted: one load each for the whole loop.
    const cr = c.rack, hr = h.rack;
    const alive = cr.alive, roomOf = cr.room, openedOf = cr.opened, pduCapW = cr.pduCapW, pduLoss = cr.pduLoss;
    const lbIdleW = cr.lbIdleW, battery = hr.batteryJ, rackPowered = hr.powered;
    const coolerWOf = hr.coolerW, tempF = hr.tempF, drawW = hr.drawW, pduUsage = hr.pduUsage, heatW = hr.heatW, overRack = hr.overTicks;
    const rackAny = k.rackAny, rackIn = k.rackIn, rackDuty = k.rackDuty, linkRack = links.rack;
    for (let r = 0; r < cr.len; r += 1) {
      if (alive[r] !== 1) continue;
      const room = roomOf[r]!;
      const opened = openedOf[r] === 1;
      const powered = opened && rackAny[r] === 1;
      // Above 80 °F everything in the rack duty-cycles: its draw, and so its heat, falls with what it does.
      const duty = thermalDuty(tempF[r]!);
      const switchW = powered ? linkRack[r]! * duty : 0;
      const lbW = powered ? routerW(lbIdleW[r]!) * duty : 0;
      const coolerW = powered ? coolerWOf[r]! : 0;
      if (duty !== 1 || rackDuty[r] !== 1) writeRackDraw(w, r, k, duty);
      const systemsW = rackIn[r]! * duty;
      const delivered = systemsW + switchW + lbW + coolerW;
      const cap = opened ? pduCapW[r]! : 0;
      // supplyUsage and supplyLossW (phys/supplies.ts), with the usage computed once.
      const usage = cap > 0 ? delivered / cap : 0;
      const loss = cap > 0 ? delivered * pduLoss[r]! * supplyMultiplier(usage) : 0;
      drawW[r] = delivered;
      pduUsage[r] = usage;
      // The starter rack's PDU limits its board before the Rack view opens too.
      overRack[r] = pduCapW[r]! > 0 && delivered > pduCapW[r]! ? overRack[r]! + 1 : 0;
      if (overRack[r]! > OVERLOAD_TRIP_TICKS) (trips ??= []).push(r);
      // D31.3: while the round runs and the rack is powered, its PDU input comes from the battery first.
      const charge = battery[r]!;
      if (roundOn && charge > 0 && rackPowered[r] === 1 && delivered + loss > 0) {
        const covered = Math.min(charge, (delivered + loss) * DT_S);
        battery[r] = charge - covered;
        roomBat[room] = roomBat[room]! + covered / DT_S;
      }
      // Heat is the watts drawn in the rack (spec §10.3): systems, PDU loss, switch and LB.
      heatW[r] = opened ? systemsW + loss + switchW + lbW : 0;
      roomIn[room] = roomIn[room]! + delivered + loss;
      roomHeat[room] = roomHeat[room]! + coolerW;
      if (delivered > 0) roomAny[room] = 1;
    }
  }
  /* Zone UPSs: rack inputs plus network rack and room cooling, split across the zone's UPSs (dualFeed). */
  const siteIn = scratch('siteIn', c.site.len), siteAny = scratch('siteAny', c.site.len), siteBat = scratch('siteBat', c.site.len);
  for (let m = 0; m < c.room.len; m += 1) {
    if (c.room.alive[m] !== 1) continue;
    const site = c.room.site[m]!;
    const opened = c.room.opened[m] === 1;
    const powered = opened && roomAny[m] === 1;
    // The network rack stands in the zone's air and duty-cycles on its line (spec §10.4).
    const networkW = powered ? (links.room[m]! + routerW(c.room.lbIdleW[m]!)) * (opened ? thermalDuty(h.room.tempF[m]!) : 1) : 0;
    const coolerW = powered ? h.room.coolerW[m]! : 0;
    const delivered = roomIn[m]! + networkW + coolerW;
    const loss = opened ? upsStep(w, m, delivered, settings) : 0;
    h.room.drawW[m] = delivered;
    let upsOver = false;
    for (let i = 0; opened && i < Math.min(MAX_UPS, settings.upsCount[m]!); i += 1) upsOver ||= h.room.upsUsage[m * MAX_UPS + i]! > 1;
    h.room.overTicks[m] = upsOver ? h.room.overTicks[m]! + 1 : 0;
    if (h.room.overTicks[m]! > OVERLOAD_TRIP_TICKS) for (let i = 0; i < RACKS_PER_ROOM; i += 1) { const r = c.room.racks[m * RACKS_PER_ROOM + i]!; if (r >= 0) (trips ??= []).push(r); }
    h.room.heatW[m] = opened ? roomHeat[m]! + networkW + loss : 0;
    siteIn[site] = siteIn[site]! + delivered + loss;
    // Battery watts skip the UPS loss on their share too.
    if (roomBat[m]! > 0) siteBat[site] = siteBat[site]! + (delivered > 0 ? roomBat[m]! * (delivered + loss) / delivered : roomBat[m]!);
    if (delivered > 0) siteAny[site] = 1;
  }

  /* Site grids and billing (spec §9.6). */
  let anyPowered = false;
  for (let s = 0; s < c.site.len; s += 1) {
    if (c.site.alive[s] !== 1) continue;
    const opened = c.site.opened[s] === 1;
    const powered = siteAny[s] === 1;
    anyPowered ||= powered;
    const delivered = siteIn[s]! + (opened && powered ? links.site[s]! : 0);
    const cap = opened ? c.site.gridCapW[s]! : 0;
    const loss = cap > 0 ? supplyLossW(delivered, cap, c.site.gridLoss[s]!) : 0;
    h.site.drawW[s] = delivered;
    h.site.gridUsage[s] = supplyUsage(delivered, cap);
    h.site.overTicks[s] = h.site.gridUsage[s]! > 1 ? h.site.overTicks[s]! + 1 : 0;
    if (h.site.overTicks[s]! > OVERLOAD_TRIP_TICKS) {
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
        const m = c.site.zones[s * MAX_ZONES_PER_SITE + z]!;
        for (let i = 0; m >= 0 && i < RACKS_PER_ROOM; i += 1) { const r = c.room.racks[m * RACKS_PER_ROOM + i]!; if (r >= 0) (trips ??= []).push(r); }
      }
    }
    billSiteInput(w, s, delivered, loss, siteBat[s]!);
  }
  billUtility(w, links.utility, anyPowered);
  if (trips) for (const r of trips) tripRack(w, r);
}

/**
 * A tripped supply cuts power to every drawing system below it: their work fails with `power` and they
 * restart cold (one boot time). The overload timers of the rack, its zone and its site start again.
 */
function tripRack(w: World, r: number): void {
  const c = w.compiled, h = w.hot;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[r * SERVERS_PER_RACK + k]!;
    if (s < 0 || c.sys.alive[s] !== 1 || !(h.sys.drawW[s]! > 0)) continue;
    killSystem(w, s, 'power');
    startTransition(w, s, 'cold');
  }
  const m = c.rack.room[r]!;
  h.rack.overTicks[r] = 0; h.room.overTicks[m] = 0; h.site.overTicks[c.room.site[m]!] = 0;
}

/**
 * D31: a site's input is met first by rack batteries (their share, with the grid loss on it), then by
 * site generation up to its output; only the rest is imported at the region price. Generation fuel is
 * billed at its share of that price. The round's energy lines collect each part in Credits.
 */
function billSiteInput(w: World, s: number, delivered: number, loss: number, batteryW: number): void {
  const total = delivered + loss;
  const fromBattery = Math.min(total, delivered > 0 ? batteryW * total / delivered : batteryW);
  const rest = total - fromBattery;
  const genW = siteGenerationW(w, s);
  const fromGen = Math.min(rest, genW);
  w.hot.site.genUsedW[s] = fromGen;
  const fuel = fromGen > 0 ? generationFuelShare(w, s) : 0;
  billSite(w, s, rest - fromGen + fromGen * fuel);
  if (fromBattery === 0 && fromGen === 0) return;
  const g = w.hot.g, credits = DT_S * sitePrice(w, s);
  g[G.roundFromBattery] = g[G.roundFromBattery]! + fromBattery * credits;
  g[G.roundFromGeneration] = g[G.roundFromGeneration]! + fromGen * credits;
  g[G.roundFuel] = g[G.roundFuel]! + fromGen * fuel * credits;
}

/** One zone's UPS step: the load is shared equally by its UPSs. Returns the summed loss. */
function upsStep(w: World, m: number, delivered: number, settings: PhysSettings): number {
  const c = w.compiled.room, h = w.hot.room;
  const count = Math.min(MAX_UPS, settings.upsCount[m]!);
  let loss = 0;
  for (let i = 0; i < count; i += 1) {
    const k = m * MAX_UPS + i;
    const share = delivered / count;
    const cap = c.upsCapW[k]!;
    if (cap > 0) loss += supplyLossW(share, cap, c.upsLoss[k]!);
    h.upsUsage[k] = supplyUsage(share, cap);
  }
  return loss;
}

/**
 * One system's full power step. Writes its rack contribution to the cache and records whether
 * it was a fixed point: it changed none of the system's phys state. A running C-state or S3
 * timer changes nothing until its threshold tick, which is kept as the step's due tick.
 */
function systemStep(w: World, s: number, settings: PhysSettings, researchOn: boolean, k: PowerCache): void {
  const c = w.compiled, sys = w.hot.sys;
  const mode0 = sys.mode[s], cstate0 = sys.cstate[s];
  const dvfs0 = sys.dvfsOn[s], turbo0 = sys.turboOn[s], wake0 = sys.wakeTicks[s], clock0 = sys.clockFactor[s];
  const kind = drawKind(sys.mode[s]!, researchOn && sys.researchThreads[s]! > 0);
  const delivered = systemDraw(w, s, kind, settings);
  sys.drawW[s] = delivered;
  k.delivered[s] = delivered;
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
  k.stampIdle[s] = kind !== DRAW_NONE && fullyBusy ? 1 : 0;
  k.stampEmpty[s] = sleep === SLEEP_STAMP ? 1 : 0;
  k.due[s] = due;
  k.stable[s] = sleep !== SLEEP_CHANGED
    && sys.mode[s] === mode0 && sys.cstate[s] === cstate0 && sys.dvfsOn[s] === dvfs0
    && sys.turboOn[s] === turbo0 && sys.wakeTicks[s] === wake0 && sys.clockFactor[s] === clock0 ? 1 : 0;
  if (k.stable[s] === 0) noteUnstable(k, s);
  if (due !== Infinity) noteDue(k, s, due);
  recordInputs(w, s, k);
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
  if (mode === MODE.paused || mode === MODE.empty || mode === MODE.standby) return SLEEP_NONE;
  const holding = h.running[s]! + h.queueLen[s]! + h.reserved[s]! + h.researchThreads[s]! > 0;
  if (mode !== MODE.onMarket || holding) { h.emptySinceTick[s] = w.tick; return SLEEP_STAMP; }
  if (!settings.s3Sleep || w.compiled.rack.opened[w.compiled.sys.rack[s]!] !== 1) return SLEEP_NONE;
  if (w.tick - Math.max(h.emptySinceTick[s]!, w.round.startTick) < S3_AFTER_TICKS) return SLEEP_WAIT;
  setUnitMode(w, s, MODE.asleep);
  return SLEEP_CHANGED;
}

/** Wakes an asleep system: on market `ticks` later (2 s by demand, the controller's latency otherwise; D31). */
export function wakeSystem(w: World, s: number, ticks = S3_WAKE_TICKS): void {
  if (w.hot.sys.mode[s] === MODE.asleep && w.hot.sys.wakeTicks[s] === 0) { w.hot.sys.wakeTicks[s] = Math.max(1, ticks); touchSystem(w, s); }
}
