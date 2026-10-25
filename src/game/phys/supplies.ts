import { MAX_UPS, OVERLOAD_FAIL_TICKS } from '../core/constants';
import { pushEvent } from '../core/events';
import { MODE, setUnitMode } from '../core/timers';
import { touchSystem } from '../core/touch';
import type { World } from '../core/world';
import { killSubtree } from '../exec';
import { rackId, roomId, siteId, systemId } from '../types/ids';
import { CAP_HEADROOM, CAP_STEPS_MAX, CAP_STEPS_MIN, SUPPLY_BAND_1, SUPPLY_BAND_2, SUPPLY_MULT, UPS_RIDE_TICKS } from './constants';
import { forSiteRooms, syncMode, syncRack, syncRoom, syncSite, zoneDark } from './modes';
import { physSettings } from './settings';

/* ---------- Supply math (spec §9.2, §9.4, §9.5) ---------- */

/** Loss multiplier by usage (D4.3): ×1 up to 90%, ×1.5 up to 100%, ×3 above. */
export const supplyMultiplier = (usage: number): number =>
  usage <= SUPPLY_BAND_1 ? SUPPLY_MULT[0] : usage <= SUPPLY_BAND_2 ? SUPPLY_MULT[1] : SUPPLY_MULT[2];

/** Usage of a supply. A supply without a compiled capacity is unlimited (usage 0). */
export const supplyUsage = (deliveredW: number, capacityW: number): number => (capacityW > 0 ? deliveredW / capacityW : 0);

/** Waste watts: real power, billed, and heat in the lump that holds the supply. */
export const supplyLossW = (deliveredW: number, capacityW: number, lossFraction: number): number =>
  deliveredW * lossFraction * supplyMultiplier(supplyUsage(deliveredW, capacityW));

/**
 * Overload timer in ticks: +1 while over 100%, otherwise −1 down to 0, so 8 s accumulated take
 * 8 s to clear. `counts` is false for a capped supply whose fixed draw fits (spec §9.5).
 */
export const stepOverload = (overTicks: number, usage: number, counts = true): number =>
  usage > 1 && counts ? overTicks + 1 : Math.max(0, overTicks - 1);

export const overloadFailed = (overTicks: number): boolean => overTicks >= OVERLOAD_FAIL_TICKS;

/**
 * Next power-cap factor in tenths (spec §9.5). `fixedW` is the draw compute load cannot change;
 * `capW` is the core and clock load at factor 1. Over capacity: down one tenth per 10% excess.
 * Up one tenth when the next step still leaves 10% headroom.
 */
export function stepCap(tenths: number, fixedW: number, capW: number, capacityW: number): number {
  if (capacityW <= 0) return CAP_STEPS_MAX;
  const drawn = fixedW + (capW * tenths) / CAP_STEPS_MAX;
  if (drawn > capacityW) {
    const steps = Math.max(1, Math.ceil((drawn / capacityW - 1) * CAP_STEPS_MAX));
    return Math.max(CAP_STEPS_MIN, tenths - steps);
  }
  if (tenths < CAP_STEPS_MAX && fixedW + (capW * (tenths + 1)) / CAP_STEPS_MAX <= CAP_HEADROOM * capacityW) return tenths + 1;
  return tenths;
}

/* ---------- Failure and reboot (spec §9.4) ---------- */

export function failPsu(w: World, sys: number): void {
  const h = w.hot.sys;
  h.psuOverTicks[sys] = 0;
  h.psuRebootTicks[sys] = w.research.unlocks.bootTicks;
  h.failedTick[sys] = w.tick;
  touchSystem(w, sys);
  killSubtree(w, { kind: 'system', id: systemId(sys) }, 'power');
  setUnitMode(w, sys, MODE.dark);
  pushEvent(w, { kind: 'supplyFailed', supply: { kind: 'psu', id: systemId(sys) } });
}

export function failPdu(w: World, rack: number): void {
  const h = w.hot.rack;
  h.pduOverTicks[rack] = 0;
  h.pduFailed[rack] = 1;
  h.pduRebootTicks[rack] = w.research.unlocks.bootTicks;
  h.failedTick[rack] = w.tick;
  killSubtree(w, { kind: 'rack', id: rackId(rack) }, 'power');
  syncRack(w, rack);
  pushEvent(w, { kind: 'supplyFailed', supply: { kind: 'pdu', id: rackId(rack) } });
}

/** A failed UPS darkens its zone only when no second UPS carries it (dualFeed). */
export function failUps(w: World, room: number, index: number): void {
  const h = w.hot.room;
  const i = room * MAX_UPS + index;
  h.upsOverTicks[i] = 0;
  h.upsFailed[i] = 1;
  h.upsRebootTicks[i] = w.research.unlocks.bootTicks;
  h.failedTick[room] = w.tick;
  if (zoneDark(w, room)) {
    killSubtree(w, { kind: 'room', id: roomId(room) }, 'power');
    syncRoom(w, room);
  }
  pushEvent(w, { kind: 'supplyFailed', supply: { kind: 'ups', id: roomId(room), index } });
}

/** With upsRideThrough, zones whose UPSs are all gen 2+ run on battery for 30 s (spec §9.4). */
export function failGrid(w: World, site: number): void {
  const h = w.hot.site;
  const settings = physSettings(w);
  // Decide the rides while the grid still counts as up, so zoneDark reflects the UPSs alone.
  forSiteRooms(w, site, (m) => {
    const ride = settings.rideThrough && w.compiled.room.opened[m] === 1 && settings.upsRide[m] === 1 && !zoneDark(w, m);
    w.hot.room.rideTicks[m] = ride ? UPS_RIDE_TICKS : 0;
  });
  h.gridOverTicks[site] = 0;
  h.gridFailed[site] = 1;
  h.gridRebootTicks[site] = w.research.unlocks.bootTicks;
  h.failedTick[site] = w.tick;
  forSiteRooms(w, site, (m) => {
    if (w.hot.room.rideTicks[m]! > 0) return;
    killSubtree(w, { kind: 'room', id: roomId(m) }, 'power');
    syncRoom(w, m);
  });
  pushEvent(w, { kind: 'supplyFailed', supply: { kind: 'grid', id: siteId(site) } });
}

/**
 * Counts down every reboot timer and ride-through battery. A supply whose timer ends is back
 * and its subtree returns to its §4.3 mode with no extra boot. Runs before this tick's failures.
 */
export function tickReboots(w: World): void {
  const { sys, rack, room, site } = w.hot;
  // Hoisted: tables are dictionary-mode objects (built by computed keys), so a per-row column lookup is a hash probe.
  const psuReboot = sys.psuRebootTicks, pduReboot = rack.pduRebootTicks;
  for (let s = 0; s < sys.len; s += 1) {
    const t = psuReboot[s]!;
    if (t <= 0) continue;
    psuReboot[s] = t - 1;
    if (t === 1) {
      syncMode(w, s);
      pushEvent(w, { kind: 'supplyRebooted', supply: { kind: 'psu', id: systemId(s) } });
    }
  }
  for (let r = 0; r < rack.len; r += 1) {
    const t = pduReboot[r]!;
    if (t <= 0) continue;
    pduReboot[r] = t - 1;
    if (t === 1) {
      rack.pduFailed[r] = 0;
      syncRack(w, r);
      pushEvent(w, { kind: 'supplyRebooted', supply: { kind: 'pdu', id: rackId(r) } });
    }
  }
  for (let m = 0; m < room.len; m += 1) {
    for (let u = 0; u < MAX_UPS; u += 1) {
      const i = m * MAX_UPS + u;
      const t = room.upsRebootTicks[i]!;
      if (t <= 0) continue;
      room.upsRebootTicks[i] = t - 1;
      if (t === 1) {
        room.upsFailed[i] = 0;
        syncRoom(w, m);
        pushEvent(w, { kind: 'supplyRebooted', supply: { kind: 'ups', id: roomId(m), index: u } });
      }
    }
    const ride = room.rideTicks[m]!;
    if (ride > 0 && w.hot.site.gridFailed[w.compiled.room.site[m]!] === 1) {
      room.rideTicks[m] = ride - 1;
      if (ride === 1) {
        killSubtree(w, { kind: 'room', id: roomId(m) }, 'power');
        syncRoom(w, m);
      }
    }
  }
  for (let s = 0; s < site.len; s += 1) {
    const t = site.gridRebootTicks[s]!;
    if (t <= 0) continue;
    site.gridRebootTicks[s] = t - 1;
    if (t === 1) {
      site.gridFailed[s] = 0;
      forSiteRooms(w, s, (m) => { room.rideTicks[m] = 0; });
      syncSite(w, s);
      pushEvent(w, { kind: 'supplyRebooted', supply: { kind: 'grid', id: siteId(s) } });
    }
  }
}
