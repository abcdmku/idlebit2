import { viewW } from '../core/constants';
import { rackPowerBudget, systemRatedWatts } from '../build/powerBudget';
import type { GameState } from '../types/state';
import type { PowerBudgetView } from '../types/views';
import { overloadS } from './common';

export function selectPowerBudget(state: GameState, system: number): PowerBudgetView {
  const s = state.build.systems[system], u = state.research.unlocks, c = state.compiled, h = state.hot;
  const rack = s?.rack ?? -1, room = c.rack.room[rack] ?? -1, site = c.room.site[room] ?? -1;
  const b = rackPowerBudget(state.build, rack, u);
  // The soonest trip among the supplies that feed this system.
  let over: number | null = null;
  for (const t of [overloadS(h.rack.overTicks[rack]), overloadS(h.room.overTicks[room]), overloadS(h.site.overTicks[site])])
    if (t !== null && (over === null || t < over)) over = t;
  return { actualW: viewW(h.sys.drawW[system] ?? 0), reservedW: viewW(systemRatedWatts(state.build, system, u)),
    rackReservedW: viewW(b.reserved), capacityW: viewW(b.capacity), rackOpen: !!state.build.racks[rack]?.opened, overloadS: over };
}
