import { classesOf, gateOn, isEligibleMode } from '../market/fleet';
import { MODE } from '../core/timers';
import { shapeOf, wantThreads } from '../exec/shape';
import type { GameState } from '../types/state';
import type { FamilyDef } from '../types/catalog';

/** Fold live core counts once per market snapshot, then reuse them for every incoming task. */
export function taskCpuCounter(state: GameState): (family: FamilyDef, size: number) => { cpuCoresWanted: number; cpuCoresAvailable: number } {
  const c = state.compiled, h = state.hot.sys;
  const machines: { rep: number; threads: number; free: number }[] = [];
  for (const cls of classesOf(c)) {
    if (c.sys.kind[cls.rep] !== 0) continue;
    let online = false, free = 0;
    for (const s of cls.members) {
      const mode = h.mode[s]!;
      if (c.sys.intent[s] !== 1 || !isEligibleMode(mode) && mode !== MODE.paused) continue;
      online = true;
      if (mode === MODE.onMarket || mode === MODE.paused) free = Math.max(free, c.sys.threads[s]! - h.busyThreads[s]!);
    }
    if (online) machines.push({ rep: cls.rep, threads: c.sys.threads[cls.rep]!, free });
  }
  return (family, size) => {
    const want = wantThreads(shapeOf(family.id), size);
    let cores = 1, available = 0;
    for (const m of machines) {
      const unsplit = c.rack.opened[c.sys.rack[m.rep]!] !== 1;
      if (gateOn(c, m.rep, family, unsplit ? size : 0) !== 0) continue;
      cores = Math.max(cores, m.threads); available = Math.max(available, m.free);
    }
    return { cpuCoresWanted: Math.min(want, cores), cpuCoresAvailable: Math.max(0, available) };
  };
}
