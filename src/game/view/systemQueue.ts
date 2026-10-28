import { MAX_SCHED_Q } from '../core/constants';
import type { World } from '../core/world';
import { freeHierarchy } from '../exec/memory';
import { startable } from '../exec/est';
import { keffOf } from '../exec/slots';
import { shapeOf, wantThreads, workingSetOf } from '../exec/shape';
import { FAMILIES, payoutAt, payoutCreditsAt } from '../market/families';
import type { GameState } from '../types/state';
import type { SystemId } from '../types/ids';
import type { SystemQueueTaskView } from '../types/views';
import { QUEUE_STRATEGY_IDS } from '../types/catalog';
import { preloadForRecord } from './preload';

/** The hardware queue, in admission order. Market offers are a separate list. Pure, lazy reads. */
export function selectSystemQueue(state: GameState, system: SystemId): readonly SystemQueueTaskView[] {
  if (!state.build.systems[system]) return [];
  const w = state as unknown as World, rec = state.hot.rec, h = state.hot.sys, c = state.compiled.sys;
  const s = system, out: SystemQueueTaskView[] = [];
  const free = Math.max(0, c.threads[s]! - h.busyThreads[s]!);
  const sliced = QUEUE_STRATEGY_IDS[c.strategy[s]!] === 'timeSlice';
  for (let r = h.queueHead[s]!; r >= 0 && out.length < MAX_SCHED_Q; r = rec.next[r]!) {
    const def = FAMILIES[rec.family[r]!]!, shape = shapeOf(def.id), units = rec.units[r]!;
    const coresWanted = Math.min(c.threads[s]!, wantThreads(shape, units));
    const ws = workingSetOf(shape, units), own = rec.preloadBits[r]!;
    const prep = preloadForRecord(state, s, r), preloading = prep?.active ?? false;
    let waitingFor: SystemQueueTaskView['waitingFor'] = 'ready';
    if (preloading) waitingFor = 'preload';
    else if (!sliced && (free === 0 || c.queuePreload[s] === 1 && free < coresWanted)) waitingFor = 'cores';
    else if (ws - own > freeHierarchy(w, s)) waitingFor = 'memory';
    else if (h.running[s]! >= keffOf(w, s) - (h.researchThreads[s]! > 0 ? 1 : 0)) waitingFor = 'slots';
    else if (!startable(w, s, r, sliced)) waitingFor = 'device';
    const p = rec.parent[r]!, whole = p >= 0 ? state.hot.parent.units[p]! : units;
    out.push({
      key: `${state.epoch}:${rec.taskId[r]!}:${rec.shard[r]!}`, taskId: rec.taskId[r]!, family: def.id, label: def.name,
      credits: payoutCreditsAt(def, whole), dataReward: payoutAt(def, whole) / (state.hot.fam.dataRatio[def.id] || def.dataRatio),
      coresWanted, coresAvailable: free, workingSetBits: ws,
      cacheTargetBits: prep?.targetBits ?? Math.min(ws, c.cacheBits[s]!),
      loadedBits: prep?.loadedBits ?? rec.preloadDone[r]!, preloading, waitingFor,
    });
  }
  return out;
}
