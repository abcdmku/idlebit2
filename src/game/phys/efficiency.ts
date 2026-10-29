import { FLOOR_TEMP_F } from '../core/constants';
import type { World } from '../core/world';
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

/** Heat reduces rates through e(T); cooling never kills tasks or powers hardware off. */
export function rackHealth(w: World, r: number, tempF: number, throttleResearched: boolean): void {
  const h = w.hot.rack;
  const wasCrashed = h.crashed[r] === 1;
  h.crashed[r] = 0; h.crashTicks[r] = 0; h.recoverTicks[r] = 0;
  if (wasCrashed) syncRack(w, r);
  const throttled = nextThrottle(h.throttled[r] === 1, tempF, throttleResearched) ? 1 : 0;
  if (throttled !== h.throttled[r]) {
    h.throttled[r] = throttled;
    forRackSystems(w, r, (s) => publishClockFactor(w, s));
  }
}

export function roomHealth(w: World, m: number, _tempF: number): void {
  const h = w.hot.room, wasCrashed = h.crashed[m] === 1;
  h.crashed[m] = 0; h.crashTicks[m] = 0; h.recoverTicks[m] = 0;
  if (wasCrashed) syncRoom(w, m);
}
