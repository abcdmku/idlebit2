import { deepestCState } from '../build/settings';
import type { SystemId } from '../types/ids';
import type { GameState } from '../types/state';

/** Saved settings and researched choices for the system's power-supply controls. */
export function selectSystemPower(state: GameState, system: SystemId) {
  const spec = state.build.systems[system]?.spec;
  if (!spec) return null;
  const u = state.research.unlocks, has = (id: 'dvfs' | 'turbo') => u.rules.includes(id);
  return { ...spec.settings, maxCState: deepestCState(state), live: u.levels.system,
    cStateResearchLevel: u.ruleParams.coreIdle?.level ?? 0,
    sleepStates: [{ depth: 0, idleFactor: 1, wakeS: 0 }, { depth: 1, idleFactor: u.ruleParams.coreIdle?.factor ?? 1, wakeS: 0 }],
    dvfsAvailable: has('dvfs'), turboAvailable: has('turbo'),
    dvfsClock: u.ruleParams.dvfs?.clock ?? 0.5, dvfsWatts: u.ruleParams.dvfs?.loadWatts ?? 0.3,
    turboClock: u.ruleParams.turbo?.clock ?? 1.25, turboWatts: u.ruleParams.turbo?.loadWatts ?? 1.8 };
}
