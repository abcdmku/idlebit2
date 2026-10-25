import { CRASH_TEMP_F, CRASH_TICKS, FLOOR_TEMP_F, RECOVER_TEMP_F } from '../core/constants';
import { pushEvent } from '../core/events';
import type { World } from '../core/world';
import { killSubtree } from '../exec';
import { rackId, roomId } from '../types/ids';
import {
  EFF_FLAT_HIGH_F, EFF_FLAT_LOW_F, EFF_GAIN_PER_F, EFF_LOSS_PER_F, EFF_MAX, EFF_MIN, THROTTLE_AT_F, THROTTLE_UNTIL_F,
} from './constants';
import { publishClockFactor } from './draw';
import { forRackSystems, syncRack, syncRoom } from './modes';

/**
 * e(T) (spec §10.4): 1.10 at or below 50 °F, +0.5%/°F below 70, flat 70–80, −2.5%/°F above 80 to
 * a 0.25 floor (0.50 at 100 °F). Scales compute and GPU rates and divides the heat a rack makes.
 */
export function efficiency(tempF: number): number {
  if (tempF <= FLOOR_TEMP_F) return EFF_MAX;
  if (tempF < EFF_FLAT_LOW_F) return 1 + EFF_GAIN_PER_F * (EFF_FLAT_LOW_F - tempF);
  if (tempF <= EFF_FLAT_HIGH_F) return 1;
  return Math.max(EFF_MIN, 1 - EFF_LOSS_PER_F * (tempF - EFF_FLAT_HIGH_F));
}

/** Throttle hysteresis (spec §9.3): on at ≥ 95 °F, held until below 90 °F. */
export const nextThrottle = (on: boolean, tempF: number, researched: boolean): boolean =>
  researched && (tempF >= THROTTLE_AT_F || (on && tempF >= THROTTLE_UNTIL_F));

/** Crash timer in ticks (spec §10.7): +1 at or above 100 °F, otherwise −1 down to 0. */
export const stepCrashTimer = (ticks: number, tempF: number): number =>
  tempF >= CRASH_TEMP_F ? ticks + 1 : Math.max(0, ticks - 1);

/**
 * One rack's crash, recovery and throttle after its new temperature. A crash kills the rack's work
 * with cause `heat`; it recovers once the boot time has passed and it is below 90 °F.
 */
export function rackHealth(w: World, r: number, tempF: number, throttleResearched: boolean): void {
  const h = w.hot.rack;
  if (h.crashed[r] === 1) {
    if (h.recoverTicks[r]! > 0) h.recoverTicks[r] = h.recoverTicks[r]! - 1;
    if (h.recoverTicks[r] === 0 && tempF < RECOVER_TEMP_F) {
      h.crashed[r] = 0;
      syncRack(w, r);
      pushEvent(w, { kind: 'recovered', lump: { kind: 'rack', id: rackId(r) } });
    }
  } else {
    h.crashTicks[r] = stepCrashTimer(h.crashTicks[r]!, tempF);
    if (h.crashTicks[r]! >= CRASH_TICKS) {
      h.crashed[r] = 1;
      h.crashTicks[r] = 0;
      h.recoverTicks[r] = w.research.unlocks.bootTicks;
      h.failedTick[r] = w.tick;
      killSubtree(w, { kind: 'rack', id: rackId(r) }, 'heat');
      syncRack(w, r);
      pushEvent(w, { kind: 'crashed', lump: { kind: 'rack', id: rackId(r) } });
    }
  }
  const throttled = nextThrottle(h.throttled[r] === 1, tempF, throttleResearched) ? 1 : 0;
  if (throttled !== h.throttled[r]) {
    h.throttled[r] = throttled;
    forRackSystems(w, r, (s) => publishClockFactor(w, s));
  }
}

/** A zone's crash and recovery (spec §10.7): every system in every rack of the zone. */
export function roomHealth(w: World, m: number, tempF: number): void {
  const h = w.hot.room;
  if (h.crashed[m] === 1) {
    if (h.recoverTicks[m]! > 0) h.recoverTicks[m] = h.recoverTicks[m]! - 1;
    if (h.recoverTicks[m] === 0 && tempF < RECOVER_TEMP_F) {
      h.crashed[m] = 0;
      syncRoom(w, m);
      pushEvent(w, { kind: 'recovered', lump: { kind: 'room', id: roomId(m) } });
    }
    return;
  }
  h.crashTicks[m] = stepCrashTimer(h.crashTicks[m]!, tempF);
  if (h.crashTicks[m]! < CRASH_TICKS) return;
  h.crashed[m] = 1;
  h.crashTicks[m] = 0;
  h.recoverTicks[m] = w.research.unlocks.bootTicks;
  h.failedTick[m] = w.tick;
  killSubtree(w, { kind: 'room', id: roomId(m) }, 'heat');
  syncRoom(w, m);
  pushEvent(w, { kind: 'crashed', lump: { kind: 'room', id: roomId(m) } });
}
