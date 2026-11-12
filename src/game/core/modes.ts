import { UNIT_MODES, type UnitMode } from '../types/views';

/** u8 code of each mode in hot sys.mode. A leaf module: any domain may import it at load time. */
export const MODE = Object.fromEntries(UNIT_MODES.map((m, i) => [m, i])) as { readonly [M in UnitMode]: number };

/** The static capability set: modes that accept work within one boot time (spec §4.3). */
const ELIGIBLE = new Uint8Array(32);
ELIGIBLE[MODE.onMarket] = 1; ELIGIBLE[MODE.asleep] = 1; ELIGIBLE[MODE.standby] = 1; ELIGIBLE[MODE.boot] = 1; ELIGIBLE[MODE.cold] = 1;
export const isEligibleMode = (mode: number): boolean => ELIGIBLE[mode] === 1;

/**
 * Counts every mode change that moves a system into or out of the static capability set (derived,
 * never state). core/timers holds the only writes to a live mode column and reports each here, so
 * an answer read from one mode column stands while the column and this count do (net/stuck.ts).
 */
export const eligibility = { changes: 0 };
export function noteModeChange(from: number, to: number): void {
  if (ELIGIBLE[from] !== ELIGIBLE[to]) eligibility.changes += 1;
}
