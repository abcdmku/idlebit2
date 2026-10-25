import { MAX_ZONES_PER_SITE } from '../core/constants';
import type { World } from '../core/world';
import { canRunOn } from '../market/fleet';
import { canAdmit } from '../exec/slots';
import { shapeOf } from '../exec/shape';
import { someAdmitting, supplyOver, supplyUsage } from './metrics';
import { memo } from './routeMemo';
import { summaryCapable } from './summary';
import { GLOBAL, RACK, ROOM, SITE } from './scope';

/**
 * Filters (spec §8.4), applied in FILTER_IDS order before the strategy. Each removes candidates;
 * a filter that would remove every candidate is skipped for that decision. Health, power and
 * thermal read the previous tick's phys state.
 */
export const FILTER_BIT = { region: 1, capability: 2, health: 4, power: 8, thermal: 16 } as const;
export const POWER_LIMIT = 0.9;
export const THERMAL_LIMIT_F = 90;

/** region (global): only sites in a region-locked task's region. */
function regionOk(w: World, kind: number, u: number, r: number): boolean {
  if (kind !== GLOBAL) return true;
  const region = shapeOf(w.hot.rec.family[r]!).region;
  return region < 0 || w.compiled.site.region[u] === region;
}

/**
 * capability: the candidate contains a system that can admit now and can run the task (§6.3, never
 * threads). Zones and sites answer one-member tasks from the routing summary's class minima, the
 * same answer without visiting their systems (net/summary.ts).
 */
export const capable = (w: World, kind: number, u: number, r: number): boolean =>
  (kind === SITE || kind === GLOBAL) && memo.exact && shapeOf(w.hot.rec.family[r]!).members === 1
    ? summaryCapable(w, kind, u, r)
    : someAdmitting(w, kind, u, (s) => canAdmit(w, s) && canRunOn(w, s, r) === 0);

/** health: no supply overload timer and no crash timer on the candidate's own chain. */
function healthy(w: World, kind: number, u: number): boolean {
  const h = w.hot;
  switch (kind) {
    case RACK: { const rack = w.compiled.sys.rack[u]!; return h.sys.psuOverTicks[u]! <= 0 && h.rack.pduOverTicks[rack]! <= 0 && h.rack.crashTicks[rack]! <= 0; }
    case ROOM: return !supplyOver(w, ROOM, u) && h.rack.crashTicks[u]! <= 0;
    case SITE: return !supplyOver(w, SITE, u) && h.room.crashTicks[u]! <= 0;
    default: return !supplyOver(w, GLOBAL, u);
  }
}

/** power: the candidate's own supply is below 90% and not counting down. */
const powered = (w: World, kind: number, u: number): boolean => supplyUsage(w, kind, u) < POWER_LIMIT && !supplyOver(w, kind, u);

/** thermal (room scope and up): racks, zones, or a site's hottest zone below 90 °F. */
function cool(w: World, kind: number, u: number): boolean {
  const h = w.hot, c = w.compiled;
  switch (kind) {
    case RACK: return true;
    case ROOM: return h.rack.tempF[u]! < THERMAL_LIMIT_F;
    case SITE: return h.room.tempF[u]! < THERMAL_LIMIT_F;
    default:
      for (let z = 0; z < MAX_ZONES_PER_SITE; z += 1) {
        const m = c.site.zones[u * MAX_ZONES_PER_SITE + z]!;
        if (m >= 0 && h.room.tempF[m]! >= THERMAL_LIMIT_F) return false;
      }
      return true;
  }
}

function passes(w: World, bit: number, kind: number, u: number, r: number): boolean {
  switch (bit) {
    case FILTER_BIT.region: return regionOk(w, kind, u, r);
    case FILTER_BIT.capability: return capable(w, kind, u, r);
    case FILTER_BIT.health: return healthy(w, kind, u);
    case FILTER_BIT.power: return powered(w, kind, u);
    default: return cool(w, kind, u);
  }
}

/** Applies the router's filter mask to cand[0..n) (slot[] kept parallel). Returns the kept count. */
export function applyFilters(w: World, mask: number, kind: number, r: number, cand: Int32Array, slot: Int32Array, n: number): number {
  for (let bit = 1; bit <= FILTER_BIT.thermal; bit <<= 1) {
    if ((mask & bit) === 0) continue;
    let keep = 0;
    for (let i = 0; i < n; i += 1) if (passes(w, bit, kind, cand[i]!, r)) keep += 1;
    if (keep === 0 || keep === n) continue;
    let j = 0;
    for (let i = 0; i < n; i += 1) {
      if (!passes(w, bit, kind, cand[i]!, r)) continue;
      cand[j] = cand[i]!; slot[j] = slot[i]!; j += 1;
    }
    n = j;
  }
  return n;
}
