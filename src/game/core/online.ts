import { killSubtree } from '../exec';
import type { ActionOf, ActionOutcome } from '../types/actions';
import type { BuildState } from '../types/build';
import { systemId, type UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import { cloneCompiled } from './buffers';
import { MODE, restingMode, setUnitMode, startTransition } from './timers';
import { writeTopology } from './topology';
import { commitWorld, openWorld } from './world';

/** Modes an online/offline switch acts on. dark, crashed and cold resolve through restingMode later. */
const SWITCHABLE = new Set<number>([MODE.onMarket, MODE.asleep, MODE.boot, MODE.goingOffline, MODE.draining, MODE.offline, MODE.paused, MODE.standby]);

function withOnline(build: BuildState, unit: UnitRef, online: boolean): BuildState | null {
  const patch = <T extends { online: boolean }>(list: readonly (T | null)[], id: number): (T | null)[] | null => {
    const item = list[id];
    return item ? list.map((x, i) => (i === id ? { ...item, online } : x)) : null;
  };
  const revision = build.revision + 1;
  switch (unit.kind) {
    case 'system': { const systems = patch(build.systems, unit.id); return systems && { ...build, systems, revision }; }
    case 'rack': { const racks = patch(build.racks, unit.id); return racks && { ...build, racks, revision }; }
    case 'room': { const rooms = patch(build.rooms, unit.id); return rooms && { ...build, rooms, revision }; }
    case 'site': { const sites = patch(build.sites, unit.id); return sites && { ...build, sites, revision }; }
  }
}

/**
 * setOnline (spec §4.4, D1.8). Between rounds it applies at once. While a round runs, every system
 * whose effective switch changes starts the one boot time: going offline kills its work with
 * `swap` (base) or drains it (gracefulDrain; exec starts the transition when the drain ends);
 * coming online boots. Toggling mid-transition starts the opposite transition from now.
 */
export function setOnline(state: GameState, action: ActionOf<'setOnline'>): ActionOutcome {
  const build = withOnline(state.build, action.unit, action.online);
  if (!build) return { ok: false, state, rejection: { code: 'invalid', reason: 'No such unit' } };
  const compiled = cloneCompiled(state.compiled);
  writeTopology(compiled, build);
  const next: GameState = { ...state, build, compiled };
  const w = openWorld(next);
  const running = state.round.phase === 'running';
  const drain = state.research.unlocks.rules.includes('gracefulDrain');
  const before = state.compiled.sys.intent;
  for (let s = 0; s < compiled.sys.len; s += 1) {
    if (compiled.sys.alive[s] !== 1 || compiled.sys.intent[s] === before[s]) continue;
    const mode = w.hot.sys.mode[s]!;
    if (!SWITCHABLE.has(mode)) continue;
    if (!running) { setUnitMode(w, s, restingMode(w, s)); continue; }
    if (compiled.sys.intent[s] === 1) {
      if (mode === MODE.draining) setUnitMode(w, s, MODE.onMarket);
      else startTransition(w, s, 'boot');
    } else if (drain && mode !== MODE.boot && mode !== MODE.offline) {
      setUnitMode(w, s, MODE.draining);
    } else {
      killSubtree(w, { kind: 'system', id: systemId(s) }, 'swap');
      startTransition(w, s, 'goingOffline');
    }
  }
  return { ok: true, state: commitWorld(next, w, state.clock.carryMs) };
}
