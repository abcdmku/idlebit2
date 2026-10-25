import { amount, ZERO_AMOUNT, type Amount } from '../amount';
import { REGIONS } from '../core/constants';
import { MODE } from '../core/timers';
import { RESOURCES } from '../types/catalog';
import { rackId, roomId, systemId, type UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { LenderView } from '../types/views';
import { researchShare } from './chip';
import { unitLabel } from './labels';
import { systemLoad } from './rack';

/** The wafer shows at most this many fab-line gauges. */
export const MAX_LENDERS = 24;
const R = RESOURCES.length;

/** Task and lent fractions of one system (spec §11.2). Offline, paused and research-only systems lend everything. */
function systemShares(state: GameState, s: number): { task: number; lent: number } {
  const task = systemLoad(state, s);
  if (state.research.active === null || state.research.stoppedInsolvent) return { task, lent: 0 };
  const m = state.hot.sys.mode[s];
  if (m === MODE.offline || m === MODE.paused) return { task: 0, lent: 1 };
  if (m !== MODE.onMarket && m !== MODE.asleep && m !== MODE.draining) return { task, lent: 0 };
  return { task, lent: researchShare(state, task) };
}

interface Acc { unit: UnitRef; online: boolean; task: number; lent: number; n: number }

/**
 * Fab-line lending gauges: one per system while there are at most 24, else one per rack, else one
 * per zone. Aggregates are means over the systems inside. O(systems); the wafer is a lazy selector.
 */
export function researchLenders(state: GameState): LenderView[] {
  const c = state.compiled;
  let systems = 0, racks = 0;
  for (let s = 0; s < c.sys.len; s += 1) if (c.sys.alive[s] === 1) systems += 1;
  for (let r = 0; r < c.rack.len; r += 1) if (c.rack.alive[r] === 1) racks += 1;
  const by: 'system' | 'rack' | 'room' = systems <= MAX_LENDERS ? 'system' : racks <= MAX_LENDERS ? 'rack' : 'room';
  const acc = new Map<number, Acc>();
  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1) continue;
    const key = by === 'system' ? s : by === 'rack' ? (c.sys.rack[s] ?? 0) : (c.sys.room[s] ?? 0);
    let a = acc.get(key);
    if (!a) {
      const unit: UnitRef = by === 'system' ? { kind: 'system', id: systemId(key) }
        : by === 'rack' ? { kind: 'rack', id: rackId(key) } : { kind: 'room', id: roomId(key) };
      a = { unit, online: false, task: 0, lent: 0, n: 0 };
      acc.set(key, a);
    }
    const sh = systemShares(state, s);
    a.online ||= c.sys.intent[s] === 1;
    a.task += sh.task; a.lent += sh.lent; a.n += 1;
  }
  const out: LenderView[] = [];
  for (const a of acc.values()) {
    if (out.length >= MAX_LENDERS) break;
    out.push({ unit: a.unit, label: unitLabel(state, a.unit), online: a.online, task: a.task / a.n, lent: a.lent / a.n });
  }
  return out;
}

/**
 * Whole Credits per minute the active project costs between rounds, when every system researches
 * at full load: Σ (CPU idle + load W) × the site's energy price × 60 s. An estimate for the plate;
 * the ledger bills real joules. TODO(S4): swap for a phys helper once one exists.
 */
export function researchCreditsPerMinute(state: GameState): Amount {
  if (state.research.active === null) return ZERO_AMOUNT;
  const c = state.compiled;
  let perS = 0;
  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1) continue;
    const price = REGIONS[c.site.region[c.sys.site[s] ?? 0] ?? 0]?.energyPrice ?? 0;
    perS += ((c.sys.idleW[s * R] ?? 0) + (c.sys.loadW[s * R] ?? 0)) * price;
  }
  return amount(Math.floor(perS * 60));
}
