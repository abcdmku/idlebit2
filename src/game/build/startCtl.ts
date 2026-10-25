import type { BuildState, StartCtl, StartOrder } from '../types/build';
import type { ScopeRef } from '../types/ids';
import type { GameState } from '../types/state';
import { fail, planned, type Plan } from './plan';

/**
 * D31.2 start controllers: the rack's Power control, the room's (on the UPS) and the global one (on the
 * scheduler). This module reads and writes their saved configuration; the runtime step lives in exec.
 */

/** Orders each scope offers (D31.2): rack slot or fastest; room slot or coolest; global slot, cheapest or nearest. */
export const START_ORDERS: Readonly<Record<'rack' | 'room' | 'global', readonly StartOrder[]>> = {
  rack: ['slot', 'fastest'], room: ['slot', 'coolest'], global: ['slot', 'cheapest', 'nearest'],
};
export const HEAD_WAIT_MIN_S = 1, HEAD_WAIT_MAX_S = 9, HEAD_WAIT_DEFAULT_S = 2;
export const BUSY_PCT_MIN = 50, BUSY_PCT_MAX = 95, BUSY_PCT_DEFAULT = 75;

/** A freshly installed controller: start with 1, wake when the head waits 2 s, slot order. */
export const defaultStartCtl = (gen: number, level = 1): StartCtl =>
  ({ gen, level, startWith: 1, trigger: { headWaitS: HEAD_WAIT_DEFAULT_S, busyPct: null }, order: 'slot' });

/** The controller at a scope, or null (systems have none). */
export function startCtlOf(build: BuildState, unit: ScopeRef): StartCtl | null {
  switch (unit.kind) {
    case 'rack': return build.racks[unit.id]?.powerCtl ?? null;
    case 'room': return build.rooms[unit.id]?.start ?? null;
    case 'global': return build.global.start;
    default: return null;
  }
}

/** Units a controller starts: systems in a rack, racks in a room, sites globally. */
export function startUnits(build: BuildState, unit: ScopeRef): number {
  switch (unit.kind) {
    case 'rack': return build.racks[unit.id]?.servers.filter((s) => s !== null).length ?? 0;
    case 'room': return build.rooms[unit.id]?.racks.filter((r) => r !== null).length ?? 0;
    case 'global': return build.sites.filter((s) => s !== null && s.opened).length;
    default: return 0;
  }
}

export function withStartCtl(build: BuildState, unit: ScopeRef, ctl: StartCtl): BuildState | null {
  const at = <T>(list: readonly (T | null)[], id: number, edit: (x: T) => T): (T | null)[] | null => {
    const x = list[id];
    return x ? list.map((y, i) => (i === id ? edit(x) : y)) : null;
  };
  switch (unit.kind) {
    case 'rack': { const racks = at(build.racks, unit.id, (r) => ({ ...r, powerCtl: ctl })); return racks && { ...build, racks }; }
    case 'room': { const rooms = at(build.rooms, unit.id, (r) => ({ ...r, start: ctl })); return rooms && { ...build, rooms }; }
    case 'global': return { ...build, global: { ...build.global, start: ctl } };
    default: return null;
  }
}

/**
 * setStartConfig (D31.2): hot and free. "Start with" is 1 … the unit count (at least 1 for an empty scope),
 * the head-wait trigger 1–9 s, the busy trigger 50–95 % at generation 1 only, and the order one the scope offers.
 */
export function planStartConfig(state: GameState, unit: ScopeRef, startWith: number, headWaitS: number, busyPct: number | null, order: StartOrder): Plan {
  if (unit.kind === 'system' || unit.kind === 'site') return fail('invalid', 'Start controllers sit at a rack, a room or the global scheduler');
  const ctl = startCtlOf(state.build, unit);
  if (!ctl) return fail('invalid', 'No start controller here');
  const total = Math.max(1, startUnits(state.build, unit));
  if (!Number.isInteger(startWith) || startWith < 1 || startWith > total) return fail('invalid', `Start with 1 to ${total}`);
  if (!Number.isInteger(headWaitS) || headWaitS < HEAD_WAIT_MIN_S || headWaitS > HEAD_WAIT_MAX_S) return fail('invalid', `Head wait ${HEAD_WAIT_MIN_S} to ${HEAD_WAIT_MAX_S} s`);
  if (busyPct !== null) {
    if (ctl.gen < 1) return fail('invalid', 'The busy trigger needs generation 1');
    if (!Number.isInteger(busyPct) || busyPct < BUSY_PCT_MIN || busyPct > BUSY_PCT_MAX) return fail('invalid', `Busy ${BUSY_PCT_MIN} to ${BUSY_PCT_MAX} %`);
  }
  if (!START_ORDERS[unit.kind].includes(order)) return fail('invalid', 'Order not offered here');
  const build = withStartCtl(state.build, unit, { ...ctl, startWith, trigger: { headWaitS, busyPct }, order });
  return build ? planned({ build, price: 0n }, 'Start') : fail('invalid', 'No such unit');
}
