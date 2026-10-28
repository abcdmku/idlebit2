import type { GameState } from '../types/state';
import { familyId } from '../types/ids';
import { shapeOf, wantThreads } from '../exec/shape';
import { clockAt } from '../exec/clocks';
import type { World } from '../core/world';
import { LOC } from '../core/buffers';

/** Record identity matters: siblings of one task can have different loading state. */
export function preloadForRecord(state: GameState, s: number, r: number): { loadedBits: number; targetBits: number; active: boolean } | null {
  const rec = state.hot.rec;
  if (r < 0 || r >= rec.len || rec.loc[r] !== LOC.queue || rec.owner[r] !== s || !(rec.preloadBits[r]! > 0)) return null;
  const active = rec.loaderThread[r]! >= 0;
  const e = state.hot.rack.effClock[state.compiled.sys.rack[s]!]!;
  const progress = active ? Math.max(0, clockAt(state as unknown as World, s, 0, e) - rec.loaderStart[r]!) : 0;
  return { loadedBits: Math.min(rec.preloadBits[r]!, rec.preloadDone[r]! + progress), targetBits: rec.preloadBits[r]!, active };
}

/** Pure read at the committed CPU work-clock boundary, including a fraction of the next bit. */
export function preloadView(state: GameState, s: number) {
  const h = state.hot.sys, rec = state.hot.rec, r = h.preloadRec[s] ?? -1;
  if (r < 0) return null;
  const prepared = preloadForRecord(state, s, r);
  if (!prepared) return null;
  return {
    taskId: rec.taskId[r]!, family: familyId(rec.family[r]!),
    ...prepared,
    requiredCores: Math.min(state.compiled.sys.threads[s]!, wantThreads(shapeOf(rec.family[r]!), rec.units[r]!)),
    availableCores: Math.max(0, state.compiled.sys.threads[s]! - h.busyThreads[s]!),
  };
}
