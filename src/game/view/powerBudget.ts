import { viewW } from '../core/constants';
import { rackPowerBudget, systemRatedWatts } from '../build/powerBudget';
import type { GameState } from '../types/state';
import type { PowerBudgetView } from '../types/views';

export function selectPowerBudget(state: GameState, system: number): PowerBudgetView {
  const s = state.build.systems[system], u = state.research.unlocks;
  const b = rackPowerBudget(state.build, s?.rack ?? -1, u);
  return { actualW: viewW(state.hot.sys.drawW[system] ?? 0), reservedW: viewW(systemRatedWatts(state.build, system, u)),
    rackReservedW: viewW(b.reserved), capacityW: viewW(b.capacity), rackOpen: !!state.build.racks[s?.rack ?? -1]?.opened };
}
