import { capacity } from '../build/catalog/curves';
import { GENERATION, GENERATION_FUEL, POWER_CTL, wakeLatencyS } from '../build/catalog/infra';
import { G } from '../core/buffers';
import { REGIONS, TICKS_PER_SECOND } from '../core/constants';
import { MODE, restingMode, setUnitMode } from '../core/timers';
import type { World } from '../core/world';
import { researchQueued } from '../exec/researchTask';
import type { StartCtl } from '../types/build';
import { S3_WAKE_TICKS } from './constants';
import { forRackSystems, forRoomRacks, forSiteRooms } from './modes';
import { wakeSystem } from './power';
import { physSettings } from './settings';

/**
 * D31.2 start controllers at round time. Return applies each powered scope's "Start with" top-down
 * (global → zones → racks); the start sub-phase (route step, before dispatch) counts power-ons down,
 * runs each controller's trigger, wakes on demand, and returns idle racks and sites to standby.
 * Racks, rooms and sites without a controller are powered and awake, as before D31.
 */

const SEC = TICKS_PER_SECOND;
/** EMA weight per tick for the 10 s busy fraction. */
const BUSY_ALPHA = 1 / (10 * SEC);
/** A room returns a rack to standby after its systems slept 30 s; global a site after its racks were off 60 s. */
const RACK_OFF_TICKS = 30 * SEC, SITE_OFF_TICKS = 60 * SEC;
/** Rack power-on at L1 is 2 s (wakeLatencyS); a site 2.5× that (5 s at L1). */
const SITE_ON_FACTOR = 2.5;
const latencyTicks = (level: number, factor = 1): number => Math.max(1, Math.round(wakeLatencyS(level) * factor * SEC));

const awakeMode = (mode: number): boolean => mode === MODE.onMarket;
const running = (w: World): boolean => w.round.phase === 'running';

/* ---------- Power state ---------- */

/** Rack r powered on or off. Off puts its systems in standby; on returns them to rest, then its own controller applies. */
function setRackPower(w: World, r: number, on: boolean): void {
  const h = w.hot.rack;
  h.powered[r] = on ? 1 : 0;
  h.wakeTicks[r] = 0;
  h.ctlTriggerTick[r] = -1;
  forRackSystems(w, r, (s) => {
    const mode = w.hot.sys.mode[s]!;
    if (on ? mode === MODE.standby : mode === MODE.onMarket || mode === MODE.asleep || mode === MODE.paused) setUnitMode(w, s, restingMode(w, s));
  });
  if (on) applyRackStart(w, r);
}

function setRoomPower(w: World, m: number, on: boolean): void {
  w.hot.room.powered[m] = on ? 1 : 0;
  w.hot.room.wakeTicks[m] = 0;
  if (!on) { forRoomRacks(w, m, (r) => setRackPower(w, r, false)); return; }
  applyRoomStart(w, m);
}

function setSitePower(w: World, s: number, on: boolean): void {
  w.hot.site.powered[s] = on ? 1 : 0;
  w.hot.site.wakeTicks[s] = 0;
  forSiteRooms(w, s, (m) => setRoomPower(w, m, on));
}

/** Units in the controller's order. Rack: slot or fastest (rated compute); room: slot or coolest; global: slot, cheapest, nearest. */
function ordered(units: number[], ctl: StartCtl, key: (u: number) => number): number[] {
  if (ctl.order === 'slot') return units;
  return [...units].sort((a, b) => key(a) - key(b) || a - b);
}

function rackOrder(w: World, r: number, ctl: StartCtl): number[] {
  const list: number[] = [];
  forRackSystems(w, r, (s) => { if (w.compiled.sys.alive[s] === 1) list.push(s); });
  const c = w.compiled.sys;
  return ordered(list, ctl, (s) => -(c.threadRate[s]! * c.cores[s]! * (c.etaCfg[s] ?? 1)));
}

function roomOrder(w: World, m: number, ctl: StartCtl): number[] {
  const list: number[] = [];
  forRoomRacks(w, m, (r) => { if (w.compiled.rack.alive[r] === 1) list.push(r); });
  return ordered(list, ctl, (r) => w.hot.rack.tempF[r] ?? 70);
}

function siteOrder(w: World, ctl: StartCtl): number[] {
  const list: number[] = [];
  for (let s = 0; s < w.compiled.site.len; s += 1) if (w.compiled.site.alive[s] === 1 && w.compiled.site.opened[s] === 1) list.push(s);
  // Nearest: backbone latency to the gateway (the gateway itself first).
  const link = w.compiled.site.backboneLink;
  return ordered(list, ctl, (s) => (ctl.order === 'cheapest' ? siteMarginalPrice(w, s) : (link[s]! >= 0 ? w.compiled.link.latencyTicks[link[s]!]! : 0)));
}

/** The rack's controller: its first "Start with" systems stay on the market, the rest sleep. */
function applyRackStart(w: World, r: number): void {
  const ctl = w.build.racks[r]?.powerCtl;
  if (!ctl || !running(w)) return;
  let kept = 0;
  for (const s of rackOrder(w, r, ctl)) {
    if (w.hot.sys.mode[s] !== MODE.onMarket) continue;
    if (kept < ctl.startWith) { kept += 1; continue; }
    setUnitMode(w, s, MODE.asleep);
    w.hot.sys.wakeTicks[s] = 0;
  }
}

/** The room's controller: its first "Start with" racks are powered, the rest stand by. Without one, all are powered. */
function applyRoomStart(w: World, m: number): void {
  const ctl = w.build.rooms[m]?.start ?? null;
  const racks = ctl ? roomOrder(w, m, ctl) : (() => { const l: number[] = []; forRoomRacks(w, m, (r) => l.push(r)); return l; })();
  racks.forEach((r, i) => setRackPower(w, r, !ctl || !running(w) || i < ctl.startWith));
}

/** Return to market (D31.2): global, then zones, then racks. Runs after the round starts. */
export function applyStart(w: World): void {
  const ctl = w.build.global.start;
  const sites = ctl ? siteOrder(w, ctl) : [];
  for (let s = 0; s < w.compiled.site.len; s += 1) {
    if (w.compiled.site.alive[s] !== 1) continue;
    const on = !ctl || sites.indexOf(s) < ctl.startWith;
    setSitePower(w, s, on);
  }
  w.hot.g[G.startBusy] = 0;
  w.hot.g[G.startTriggerTick] = -1;
}

/** Round end: every unit powered again (between rounds hardware is paused, and research may run). */
export function resetPower(w: World): void {
  const { rack, room, site } = w.hot;
  for (let r = 0; r < rack.len; r += 1) { rack.powered[r] = 1; rack.wakeTicks[r] = 0; rack.ctlTriggerTick[r] = -1; rack.ctlBusy[r] = 0; }
  for (let m = 0; m < room.len; m += 1) { room.powered[m] = 1; room.wakeTicks[m] = 0; room.ctlTriggerTick[m] = -1; room.ctlBusy[m] = 0; }
  for (let s = 0; s < site.len; s += 1) { site.powered[s] = 1; site.wakeTicks[s] = 0; site.ctlTriggerTick[s] = -1; site.ctlBusy[s] = 0; }
}

/* ---------- Battery and marginal price (D31.3, D31.4) ---------- */

export const batteryCapacityJ = (w: World, r: number): number => {
  const ctl = w.build.racks[r]?.powerCtl;
  return ctl ? capacity(POWER_CTL, ctl.gen, ctl.level) : 0;
};

/** The site's marginal price: the fuel price while generation has headroom, else the region price. */
export function siteMarginalPrice(w: World, s: number): number {
  const price = REGIONS[w.compiled.site.region[s]!]!.energyPrice;
  const gen = w.build.sites[s]?.generation;
  if (!gen) return price;
  const k = w.hot.site;
  return (k.genUsedW[s] ?? 0) < siteGenerationW(w, s) ? GENERATION_FUEL[gen.gen]! * price : price;
}

/** Site generation output (W): solar × sun, wind × wind, fuel kinds constant. */
export function siteGenerationW(w: World, s: number): number {
  const gen = w.build.sites[s]?.generation;
  if (!gen) return 0;
  const region = REGIONS[w.compiled.site.region[s]!]!;
  const factor = gen.gen === 0 ? region.sun : gen.gen === 1 ? region.wind : 1;
  return capacity(GENERATION, gen.gen, gen.level) * factor;
}
export const generationFuelShare = (w: World, s: number): number => GENERATION_FUEL[w.build.sites[s]?.generation?.gen ?? 0]!;

/** Return to market: every battery refills, billed at 25% of its site's marginal price (Credits). */
export function refillBatteries(w: World): number {
  let credits = 0;
  const h = w.hot.rack;
  for (let r = 0; r < h.len; r += 1) {
    if (w.compiled.rack.alive[r] !== 1) continue;
    const cap = batteryCapacityJ(w, r);
    const refill = Math.max(0, cap - (h.batteryJ[r] ?? 0));
    h.batteryJ[r] = cap;
    if (refill === 0) continue;
    const site = w.compiled.room.site[w.compiled.rack.room[r]!]!;
    credits += refill * 0.25 * siteMarginalPrice(w, site);
  }
  return credits;
}

/* ---------- The start sub-phase (each running tick, route step) ---------- */

/** Ticks the queue head has waited untaken (0 with no head, or while research holds the line). */
function headWaitTicks(w: World): number {
  if (researchQueued(w)) return 0;
  const { window: shown } = w.market;
  if (shown.length === 0 && w.hot.g[G.frontLen]! === 0) return 0;
  return Math.max(0, w.tick - w.market.headTick);
}

/** One controller's trigger: head waited ≥ X s, or (generation 1) busy ≥ Y %. */
const triggered = (ctl: StartCtl, waited: number, busy: number): boolean =>
  waited >= ctl.trigger.headWaitS * SEC || (ctl.gen >= 1 && ctl.trigger.busyPct !== null && busy >= ctl.trigger.busyPct / 100);

/**
 * How many units this tick's step wakes: none unless the trigger holds; then on its first tick and every
 * second after, 1 at generation 0 or ceil(25% × awake) at generation 1.
 */
function wakeCount(w: World, ctl: StartCtl, held: boolean, since: Int32Array | Float64Array, i: number, awake: number): number {
  if (!held) { since[i] = -1; return 0; }
  if (since[i]! < 0) since[i] = w.tick;
  if ((w.tick - since[i]!) % SEC !== 0) return 0;
  return ctl.gen >= 1 ? Math.max(1, Math.ceil(0.25 * awake)) : 1;
}

/** The busy fraction of a rack's awake systems: running over their running limit. */
function rackBusy(w: World, r: number): { busy: number; awake: number } {
  let run = 0, cap = 0, awake = 0;
  forRackSystems(w, r, (s) => {
    if (!awakeMode(w.hot.sys.mode[s]!)) return;
    awake += 1;
    run += w.hot.sys.running[s]!;
    cap += Math.max(1, w.compiled.sys.keff[s]!);
  });
  return { busy: cap > 0 ? run / cap : 0, awake };
}

export function startPhase(w: World): void {
  if (!running(w)) return;
  const c = w.compiled, h = w.hot;
  const waited = headWaitTicks(w);
  // Power-ons in progress.
  for (let s = 0; s < c.site.len; s += 1) {
    const t = h.site.wakeTicks[s]!;
    if (t > 0) { h.site.wakeTicks[s] = t - 1; if (t === 1) setSitePower(w, s, true); }
  }
  for (let r = 0; r < c.rack.len; r += 1) {
    const t = h.rack.wakeTicks[r]!;
    if (t > 0) { h.rack.wakeTicks[r] = t - 1; if (t === 1) setRackPower(w, r, true); }
  }
  // Global controller: sites.
  const gctl = w.build.global.start;
  if (gctl) {
    const order = siteOrder(w, gctl);
    const online = order.filter((s) => h.site.powered[s] === 1);
    let busySum = 0;
    for (const s of online) busySum += h.site.ctlBusy[s]!;
    const gb = h.g[G.startBusy]! + BUSY_ALPHA * ((online.length > 0 ? busySum / online.length : 0) - h.g[G.startBusy]!);
    h.g[G.startBusy] = gb;
    const since = new Float64Array([h.g[G.startTriggerTick]!]);
    let n = wakeCount(w, gctl, triggered(gctl, waited, gb), since, 0, online.length);
    h.g[G.startTriggerTick] = since[0]!;
    for (const s of order) {
      if (n <= 0) break;
      if (h.site.powered[s] === 1 || h.site.wakeTicks[s]! > 0) continue;
      h.site.wakeTicks[s] = latencyTicks(gctl.level, SITE_ON_FACTOR);
      n -= 1;
    }
  }
  // Room controllers: racks.
  for (let m = 0; m < c.room.len; m += 1) {
    const ctl = w.build.rooms[m]?.start;
    if (!ctl || c.room.alive[m] !== 1 || h.room.powered[m] !== 1) continue;
    const order = roomOrder(w, m, ctl);
    const on = order.filter((r) => h.rack.powered[r] === 1);
    let busySum = 0;
    for (const r of on) busySum += h.rack.ctlBusy[r]!;
    h.room.ctlBusy[m] = h.room.ctlBusy[m]! + BUSY_ALPHA * ((on.length > 0 ? busySum / on.length : 0) - h.room.ctlBusy[m]!);
    let n = wakeCount(w, ctl, triggered(ctl, waited, h.room.ctlBusy[m]!), h.room.ctlTriggerTick, m, on.length);
    for (const r of order) {
      if (n <= 0) break;
      if (h.rack.powered[r] === 1 || h.rack.wakeTicks[r]! > 0) continue;
      h.rack.wakeTicks[r] = latencyTicks(ctl.level);
      n -= 1;
    }
  }
  // Rack controllers: systems. Every powered rack keeps its busy EMA for its room and site.
  const site = new Float64Array(c.site.len), siteN = new Float64Array(c.site.len);
  for (let r = 0; r < c.rack.len; r += 1) {
    if (c.rack.alive[r] !== 1 || h.rack.powered[r] !== 1) continue;
    const { busy, awake } = rackBusy(w, r);
    h.rack.ctlBusy[r] = h.rack.ctlBusy[r]! + BUSY_ALPHA * (busy - h.rack.ctlBusy[r]!);
    const st = c.room.site[c.rack.room[r]!]!;
    site[st] = site[st]! + h.rack.ctlBusy[r]!; siteN[st] = siteN[st]! + 1;
    const ctl = w.build.racks[r]?.powerCtl;
    if (!ctl) continue;
    let n = wakeCount(w, ctl, triggered(ctl, waited, h.rack.ctlBusy[r]!), h.rack.ctlTriggerTick, r, awake);
    for (const s of rackOrder(w, r, ctl)) {
      if (n <= 0) break;
      if (h.sys.mode[s] !== MODE.asleep || h.sys.wakeTicks[s]! > 0 || c.sys.intent[s] !== 1) continue;
      wakeSystem(w, s, latencyTicks(ctl.level));
      n -= 1;
    }
  }
  for (let s = 0; s < c.site.len; s += 1) h.site.ctlBusy[s] = siteN[s]! > 0 ? site[s]! / siteN[s]! : 0;
  demandWake(w, waited);
  backToStandby(w);
}

/**
 * Base demand wake (D31.1, with s3Sleep): when the head waits and no awake system in a powered rack has
 * room, the lowest-index asleep system wakes (one per tick while the shortage lasts).
 */
function demandWake(w: World, waited: number): void {
  if (waited < 1 || !physSettings(w).s3Sleep) return;
  const c = w.compiled, h = w.hot;
  let candidate = -1;
  for (let r = 0; r < c.rack.len; r += 1) {
    if (c.rack.alive[r] !== 1 || h.rack.powered[r] !== 1) continue;
    if (h.rack.freeSlots[r]! > 0) return;
    if (candidate >= 0) continue;
    forRackSystems(w, r, (s) => {
      if (candidate < 0 && h.sys.mode[s] === MODE.asleep && h.sys.wakeTicks[s] === 0 && c.sys.intent[s] === 1) candidate = s;
    });
  }
  // A system already waking covers the shortage.
  for (let s = 0; s < h.sys.len; s += 1) if (h.sys.mode[s] === MODE.asleep && h.sys.wakeTicks[s]! > 0) return;
  if (candidate >= 0) wakeSystem(w, candidate, S3_WAKE_TICKS);
}

/** Room controllers stand down racks asleep 30 s, global sites off 60 s, never below "Start with". */
function backToStandby(w: World): void {
  const c = w.compiled, h = w.hot;
  for (let m = 0; m < c.room.len; m += 1) {
    const ctl = w.build.rooms[m]?.start;
    if (!ctl || h.room.powered[m] !== 1) continue;
    let on = 0;
    forRoomRacks(w, m, (r) => { if (h.rack.powered[r] === 1) on += 1; });
    forRoomRacks(w, m, (r) => {
      if (h.rack.powered[r] !== 1) return;
      let sleeping = true;
      forRackSystems(w, r, (s) => { const mode = h.sys.mode[s]!; if (mode !== MODE.asleep && mode !== MODE.offline && mode !== MODE.empty) sleeping = false; });
      if (!sleeping) { h.rack.offSinceTick[r] = -1; return; }
      if (h.rack.offSinceTick[r]! < 0) h.rack.offSinceTick[r] = w.tick;
      if (on > ctl.startWith && w.tick - h.rack.offSinceTick[r]! >= RACK_OFF_TICKS) { setRackPower(w, r, false); h.rack.offSinceTick[r] = -1; on -= 1; }
    });
  }
  const gctl = w.build.global.start;
  if (!gctl) return;
  let on = 0;
  for (let s = 0; s < c.site.len; s += 1) if (c.site.alive[s] === 1 && c.site.opened[s] === 1 && h.site.powered[s] === 1) on += 1;
  for (let s = 0; s < c.site.len; s += 1) {
    if (c.site.alive[s] !== 1 || h.site.powered[s] !== 1) continue;
    let off = true;
    forSiteRooms(w, s, (m) => forRoomRacks(w, m, (r) => { if (h.rack.powered[r] === 1) off = false; }));
    if (!off) { h.site.offSinceTick[s] = -1; continue; }
    if (h.site.offSinceTick[s]! < 0) h.site.offSinceTick[s] = w.tick;
    if (on > gctl.startWith && w.tick - h.site.offSinceTick[s]! >= SITE_OFF_TICKS) { setSitePower(w, s, false); h.site.offSinceTick[s] = -1; on -= 1; }
  }
}
